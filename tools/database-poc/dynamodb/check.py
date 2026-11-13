"""Run the frozen behavior scenarios against a fresh DynamoDB Local table."""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
from threading import Barrier
import unittest
from uuid import uuid4

import boto3
from botocore.config import Config

from repository import Conflict, Repository

ASSERT = unittest.TestCase()
ASSERT.maxDiff = None

FIXTURE_SHA = "d2309e27ddcff166156693f491649814b61dbd1cd8b4ba99ebbfbad53cc30523"


def concurrent(operation, inputs):
    gate = Barrier(len(inputs))

    def run(item):
        gate.wait(timeout=5)
        try:
            return operation(item)
        except Conflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=len(inputs)) as workers:
        return list(workers.map(run, inputs))


def run_scenario(repository, name, args):
    if name in {"createProduct", "createObservation"}:
        count = args.get("concurrentIdenticalCalls", 1)
        method = getattr(repository, name)
        if count == 1:
            return method(args["input"])
        outcomes = concurrent(method, [args["input"]] * count)
        ASSERT.assertEqual(outcomes, [args["input"]] * count)
        return outcomes[0]
    if name in {"createProductConflict", "createObservationConflict"}:
        method = getattr(repository, name.removesuffix("Conflict"))
        with ASSERT.assertRaises(Conflict):
            method(args["input"])
        return "conflict"
    if name == "raceProductsWithSameBarcode":
        outcomes = concurrent(repository.createProduct, args["inputs"])
        winners = [result for result in outcomes if result != "conflict"]
        return {
            "created": len(winners),
            "conflicts": outcomes.count("conflict"),
            "lookupMatchesWinner": len(winners) == 1
            and repository.lookupBarcode(args["inputs"][0]["barcode"]) == winners[0],
        }
    if name == "createDistinctObservationsConcurrently":
        return concurrent(repository.createObservation, args["inputs"])
    result = None
    for _ in range(args.pop("repeat", 1)):
        result = getattr(repository, name)(**args)
    return result


class RequestLog:
    def __init__(self):
        self.calls = []

    def record(self, model, parsed, http_response, **_kwargs):
        capacity = parsed.get("ConsumedCapacity", [])
        if isinstance(capacity, dict):
            capacity = [capacity]
        self.calls.append((model.name, http_response.status_code, capacity,
                           parsed.get("ScannedCount", 0),
                           parsed.get("ResponseMetadata", {}).get("RetryAttempts", 0)))

    def summarize(self):
        requests = Counter(name for name, *_ in self.calls)
        successes = [entry for entry in self.calls if entry[1] == 200]
        return {
            "calls": dict(requests),
            "failedCalls": len(self.calls) - len(successes),
            "retryAttempts": sum(entry[4] for entry in self.calls),
            "queryItemsRead": sum(entry[3] for entry in self.calls),
            "reportedCapacityUnits": sum(
                row.get("CapacityUnits", 0) for entry in successes for row in entry[2]
            ),
            "successfulCallsWithCapacity": sum(bool(entry[2]) for entry in successes),
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--port", type=int, default=18764)
    parser.add_argument("--query-page-size", type=int)
    args = parser.parse_args()
    fixture_bytes = args.fixture.read_bytes()
    if sha256(fixture_bytes).hexdigest() != FIXTURE_SHA:
        parser.error("expected the frozen v1 fixture")
    fixture = json.loads(fixture_bytes, parse_float=Decimal)
    client = boto3.Session().resource(
        "dynamodb",
        region_name="us-east-1",
        endpoint_url=f"http://127.0.0.1:{args.port}",
        aws_access_key_id="localtest",
        aws_secret_access_key="localtest",
        config=Config(connect_timeout=3, read_timeout=5, proxies={}),
    ).meta.client
    table = f"CheapoBakeoff_{uuid4().hex}"
    client.create_table(
        TableName=table,
        KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"},
                   {"AttributeName": "sk", "KeyType": "RANGE"}],
        AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"},
                              {"AttributeName": "sk", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    client.get_waiter("table_exists").wait(TableName=table)
    repository = Repository(client, table, args.query_page_size)
    log = RequestLog()
    client.meta.events.register("after-call.dynamodb", log.record)
    try:
        repository.seed(fixture["seed"])
        print(json.dumps({"seed": log.summarize()}))
        for number, scenario in enumerate(fixture["scenarios"], start=1):
            name = scenario["name"]
            parameters = {key: value for key, value in scenario.items()
                          if key not in {"name", "expected"}}
            log.calls.clear()
            result = run_scenario(repository, name, parameters)
            expected = scenario.get("expected")
            if name == "storedObservations":
                ASSERT.assertCountEqual(result, expected, f"{number} {name}")
            else:
                ASSERT.assertEqual(result, expected, f"{number} {name}")
            print(json.dumps({"scenario": number, "name": name, **log.summarize()}))
        print(f"PASS: {len(fixture['scenarios'])} frozen scenarios (SHA-256 {FIXTURE_SHA})")
    finally:
        client.delete_table(TableName=table)


if __name__ == "__main__":
    main()
