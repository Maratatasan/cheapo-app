"""Single-table DynamoDB repository for the local database comparison."""

from datetime import datetime, timezone
from decimal import Decimal
from fractions import Fraction
from random import uniform
from time import sleep
from urllib.parse import quote
from uuid import UUID

from boto3.dynamodb.conditions import Attr, Key

UNITS = {"g": ("kg", 1000), "kg": ("kg", 1), "ml": ("l", 1000),
         "l": ("l", 1), "each": ("each", 1)}


class Conflict(Exception):
    """The supplied identity already belongs to different data."""


def item_key(pk, sk="value"):
    return {"pk": pk, "sk": sk}


def saved_key(household_id, shop_id):
    return item_key(f"household#{household_id}", f"shop#{shop_id}")


def pair_partition(product_id, shop_id):
    return f"pair#{product_id}#{shop_id}"


def group_prefix(group):
    return f"group#{quote(group, safe='')}#"


def current_key(shop_id, product):
    return item_key(f"shop#{shop_id}", group_prefix(product["comparisonGroup"]) + product["id"])


def revision(observation):
    timestamp = datetime.fromisoformat(observation["observedAt"])
    if timestamp.utcoffset() != timezone.utc.utcoffset(timestamp):
        raise ValueError("observedAt must be in UTC")
    return f"{timestamp.isoformat(timespec='microseconds')}#{UUID(observation['id'])}"


def public_item(item):
    if item is None:
        return None
    return {name: value for name, value in item.items() if name not in {"pk", "sk"}}


def validate_price(amount):
    if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0:
        raise ValueError("priceMinor must be a non-negative integer")


class Repository:
    def __init__(self, client, table, query_page_size=None):
        self.client = client
        self.table = table
        self.query_page_size = query_page_size

    def _call(self, method, **kwargs):
        return getattr(self.client, method)(
            TableName=self.table, ReturnConsumedCapacity="TOTAL", **kwargs
        )

    def _get(self, key):
        return self._call("get_item", Key=key, ConsistentRead=True).get("Item")

    def _query(self, pk, prefix=None):
        condition = Key("pk").eq(pk)
        if prefix is not None:
            condition &= Key("sk").begins_with(prefix)
        page_size = {"Limit": self.query_page_size} if self.query_page_size else {}
        for page in self.client.get_paginator("query").paginate(
            TableName=self.table, KeyConditionExpression=condition,
            ConsistentRead=True, ReturnConsumedCapacity="TOTAL", **page_size,
        ):
            yield from page["Items"]

    def _put_new(self, key, data):
        return {"Put": {"TableName": self.table, "Item": {**key, **data},
                        "ConditionExpression": "attribute_not_exists(pk)"}}

    def _transaction(self, actions):
        try:
            self.client.transact_write_items(TransactItems=actions, ReturnConsumedCapacity="TOTAL")
            return True
        except self.client.exceptions.TransactionCanceledException as error:
            codes = {reason.get("Code") for reason in error.response.get("CancellationReasons", [])}
            if not codes.intersection({"ConditionalCheckFailed", "TransactionConflict"}):
                raise
            if not codes.issubset({"None", "ConditionalCheckFailed", "TransactionConflict"}):
                raise
            return False
        except self.client.exceptions.TransactionConflictException:
            return False

    def seed(self, data):
        for household in data["households"]:
            self._call("put_item", Item={**item_key(f"household#{household['id']}"), **household})
        for shop in data["shops"]:
            self._call("put_item", Item={**item_key(f"shop#{shop['id']}"), **shop})
        for link in data["savedShops"]:
            self.saveShop(**link)
        for product in data["products"]:
            self.createProduct(product)
        for observation in data["observations"]:
            self.createObservation(observation)

    def saveShop(self, householdId, shopId, nickname):
        link = {"householdId": householdId, "shopId": shopId, "nickname": nickname}
        actions = [self._put_new(saved_key(householdId, shopId), link)]
        for pk in (f"household#{householdId}", f"shop#{shopId}"):
            actions.append({"ConditionCheck": {"TableName": self.table, "Key": item_key(pk),
                                               "ConditionExpression": "attribute_exists(pk)"}})
        if not self._transaction(actions):
            if public_item(self._get(saved_key(householdId, shopId))) != link:
                raise Conflict("saved shop already exists or its household/shop is missing")
        return link

    def listSavedShops(self, householdId):
        return [public_item(item) for item in self._query(f"household#{householdId}", "shop#")]

    def renameSavedShop(self, householdId, shopId, nickname):
        result = self._call(
            "update_item", Key=saved_key(householdId, shopId),
            ConditionExpression=Attr("pk").exists(),
            UpdateExpression="SET nickname = :nickname",
            ExpressionAttributeValues={":nickname": nickname}, ReturnValues="ALL_NEW",
        )
        return public_item(result["Attributes"])

    def unlinkSavedShop(self, householdId, shopId):
        self._call("delete_item", Key=saved_key(householdId, shopId))

    def createProduct(self, product):
        product = {**product, "barcode": product.get("barcode")}
        barcode = product["barcode"]
        if barcode is not None and (not isinstance(barcode, str) or not barcode):
            raise ValueError("barcode must be non-empty text or null")
        quantity = product["quantity"]
        if isinstance(quantity, bool) or not isinstance(quantity, (int, Decimal)) or quantity <= 0:
            raise ValueError("quantity must be a positive integer or Decimal")
        key = item_key(f"product#{product['id']}")
        actions = [self._put_new(key, product)]
        if barcode is not None:
            barcode_key = item_key(f"barcode#{barcode}")
            actions.append(self._put_new(barcode_key, {"productId": product["id"]}))

        for attempt in range(6):
            if self._transaction(actions):
                return product
            stored = public_item(self._get(key))
            if stored == product:
                return stored
            if stored or (barcode is not None and self._get(barcode_key)):
                raise Conflict("product UUID or barcode already used")
            sleep(uniform(0, 0.005 * 2**attempt))
        raise RuntimeError("could not create product after concurrent writes")

    def lookupBarcode(self, barcode):
        pointer = self._get(item_key(f"barcode#{barcode}"))
        if pointer is None:
            return None
        return public_item(self._get(item_key(f"product#{pointer['productId']}")))

    def createObservation(self, observation):
        observation = {**observation, "photoRef": observation.get("photoRef")}
        validate_price(observation["priceMinor"])
        if observation["currency"] != "GBP":
            raise ValueError("currency must be GBP")
        version = revision(observation)
        product_id, shop_id = observation["productId"], observation["shopId"]
        product = self._get(item_key(f"product#{product_id}"))
        shop = self._get(item_key(f"shop#{shop_id}"))
        if product is None or shop is None:
            raise ValueError("observation must reference an existing product and shop")
        locator_key = item_key(f"observation#{observation['id']}")
        history_key = item_key(pair_partition(product_id, shop_id), version)
        latest_key = current_key(shop_id, product)
        locator = {"historyKey": history_key, "currentKey": latest_key, "original": observation}
        history = [self._put_new(locator_key, locator), self._put_new(history_key, observation)]
        for attempt in range(6):
            latest = self._get(latest_key)
            actions = history.copy()
            if latest is None or latest["revision"] < version:
                fields = ("brand", "variety", "quantity", "unit")
                projection = {
                    **{field: product[field] for field in fields},
                    "productId": product_id, "shopId": shop_id, "observationId": observation["id"],
                    "priceMinor": observation["priceMinor"], "revision": version,
                }
                actions.append({"Put": {
                    "TableName": self.table, "Item": {**latest_key, **projection},
                    "ConditionExpression": "attribute_not_exists(pk) OR #revision < :revision",
                    "ExpressionAttributeNames": {"#revision": "revision"},
                    "ExpressionAttributeValues": {":revision": version},
                }})
            if self._transaction(actions):
                return observation
            stored = self._get(locator_key)
            if stored is not None:
                if stored["original"] == observation:
                    return stored["original"]
                raise Conflict("observation UUID already used")
            sleep(uniform(0, 0.005 * 2**attempt))
        raise RuntimeError("could not create observation after concurrent writes")

    def latestPrice(self, productId, shopId):
        result = self._call(
            "query", KeyConditionExpression=Key("pk").eq(pair_partition(productId, shopId)),
            ScanIndexForward=False, Limit=1, ConsistentRead=True,
        )
        return public_item(next(iter(result["Items"]), None))

    def storedObservations(self, productId, shopId):
        return [public_item(item) for item in self._query(pair_partition(productId, shopId))]

    def correctObservation(self, observationId, patch):
        if not patch or patch.keys() - {"priceMinor", "photoRef"}:
            raise ValueError("correction must change priceMinor and/or photoRef")
        if "priceMinor" in patch:
            validate_price(patch["priceMinor"])
        locator = self._get(item_key(f"observation#{observationId}"))
        if locator is None:
            raise ValueError("observation does not exist")

        def changes(values):
            return {
                "UpdateExpression": "SET " + ", ".join(f"#{field} = :{field}" for field in values),
                "ExpressionAttributeNames": {f"#{field}": field for field in values},
                "ExpressionAttributeValues": {f":{field}": value for field, value in values.items()},
            }

        history_key, latest_key = locator["historyKey"], locator["currentKey"]
        for attempt in range(6):
            latest = self._get(latest_key)
            if "priceMinor" not in patch or latest["observationId"] != observationId:
                result = self._call("update_item", Key=history_key,
                                    ReturnValues="ALL_NEW", **changes(patch))
                return public_item(result["Attributes"])
            actions = [
                {"Update": {"TableName": self.table, "Key": history_key, **changes(patch)}},
                {"Update": {"TableName": self.table, "Key": latest_key,
                            **changes({"priceMinor": patch["priceMinor"]}),
                            "ConditionExpression": "observationId = :expected"}},
            ]
            actions[1]["Update"]["ExpressionAttributeValues"][":expected"] = observationId
            if self._transaction(actions):
                return public_item(self._get(history_key))
            sleep(uniform(0, 0.005 * 2**attempt))
        raise RuntimeError("could not correct observation after concurrent writes")

    def compare(self, householdId, referenceProductId, sameBrand=False, sameVariety=False):
        reference = self._get(item_key(f"product#{referenceProductId}"))
        if reference is None or reference["unit"] not in UNITS:
            return []
        unit, _ = UNITS[reference["unit"]]
        candidates = []
        for link in self.listSavedShops(householdId):
            for price in self._query(f"shop#{link['shopId']}", group_prefix(reference["comparisonGroup"])):
                if sameBrand and price["brand"] != reference["brand"]:
                    continue
                if sameVariety and price["variety"] != reference["variety"]:
                    continue
                family, factor = UNITS.get(price["unit"], (None, None))
                if family != unit:
                    continue
                normalized = Fraction(price["priceMinor"] * factor) / Fraction(price["quantity"])
                candidates.append({
                    "productId": price["productId"], "shopId": price["shopId"],
                    "observationId": price["observationId"], "unit": unit,
                    "normalizedPriceMinor": normalized,
                })
        return sorted(candidates, key=lambda price: (
            price["normalizedPriceMinor"], price["shopId"], price["productId"]
        ))
