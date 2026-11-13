# DynamoDB Local proof of concept

This prototype implements the [Cheapo database comparison](https://github.com/Maratatasan/cheapo-app/issues/125) for a local database. It uses synthetic shops and products and stores photo references as strings. It has no app or cloud integration.

## Reproduce

Download the official DynamoDB Local tarball and its checksum and verify the
download before extracting it. The tested archive was version 3.3.2 with
SHA-256 `7a94eb65f81aee270738751a4e5e3e6a7ad02a5d25194f55b83e08ec2ba6342b`.
The AWS download URL points to the current release. Use Java 17 or newer.
[Download and verification instructions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html)

From the directory containing `DynamoDBLocal.jar`, start the database on a
trusted development machine. DynamoDB Local listens on all interfaces and uses
dummy credentials. The database directory is disposable.

```sh
mkdir -p db
java -Xmx256m -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar \
  -sharedDb -dbPath db -disableTelemetry -port 18764
```

From the Cheapo repository root, use Python 3.13 and run the checker. It uses
a hard-coded loopback endpoint and dummy credentials. Each run creates,
seeds, and drops a randomly named table, including when a scenario fails.

```sh
python3 -m venv /tmp/cheapo-dynamodb-venv
/tmp/cheapo-dynamodb-venv/bin/python -m pip install -r tools/database-poc/dynamodb/requirements.txt
/tmp/cheapo-dynamodb-venv/bin/python -B tools/database-poc/dynamodb/check.py tools/database-poc/dynamodb/fixture.json
```

Add `--query-page-size 2` to exercise pagination. Press Ctrl+C in the Java
terminal when finished.

The runner verifies the exact frozen fixture SHA-256
`d2309e27ddcff166156693f491649814b61dbd1cd8b4ba99ebbfbad53cc30523`.
It checks each expected result, including ordered comparison rows and the
latest-price timestamp/UUID tie-break. It compares the history scenario as
a multiset because the contract leaves history tie ordering unspecified.
A thread barrier starts the competing writes concurrently.

## Data model and requests

One table with string partition and sort keys. All reads use the base table
with strong consistency. The prototype uses no secondary indexes or
table-wide scans.

| Data | Partition key | Sort key |
| --- | --- | --- |
| Household | `household#ID` | `value` |
| Private saved-shop link | `household#ID` | `shop#SHOP_ID` |
| Shared shop | `shop#ID` | `value` |
| Product | `product#ID` | `value` |
| Barcode reservation | `barcode#TEXT` | `value` |
| Observation UUID locator and original create payload | `observation#ID` | `value` |
| Correctable observation history | `pair#PRODUCT_ID#SHOP_ID` | `UTC_TIMESTAMP#OBSERVATION_ID` |
| Latest comparison projection | `shop#ID` | `group#ENCODED_GROUP#PRODUCT_ID` |

- **Saved shops.** A prefix query reads one household's links. Rename uses a
  conditional update of the link. Unlink deletes only the link. Save uses a
  transaction with two existence checks and one conditional insert.
- **Products.** Creating a barcoded product conditionally inserts the product
  and barcode reservation in one transaction. Lookup uses two point reads on
  a hit and one on a miss. The reservation prevents concurrent competing
  inserts and preserves leading zeros.
- **Observations.** A normal create reads the product, shop and latest
  projection. It writes the UUID locator and ordered history in a transaction.
  If the record is newer, that transaction also conditionally replaces the
  projection. A conflicting latest write triggers a reread and bounded retry.
  The locator keeps the original create payload for replay after correction.
  The latest exact price uses one descending query with limit 1. History uses
  paginated queries on the same pair.
- **Correction.** The locator identifies the history and projection keys. A
  price correction on the latest observation updates both items atomically,
  conditional on the projection still referring to that observation.
  Historical corrections and photo-only corrections update history alone.
- **Compare.** One product read, one paginated saved-shop query and one
  paginated group-prefix query per saved shop. Each query reads one current
  record per candidate product in that shop and group. The repository applies
  brand, variety and dimension filters, computes exact rational normalized
  prices, and sorts the results. Filters do not reduce DynamoDB reads.

## Observed locally

Apple Silicon M1, macOS, OpenJDK 17.0.21.0.3, DynamoDB Local 3.3.2, Python
3.13.3, boto3 1.43.118. All 34 scenarios passed with standard query pagination
and again with two items per page. The checker prints per-scenario API calls,
HTTP failures, retry counts, items evaluated by queries and DynamoDB Local's
returned capacity totals. Setup and teardown are outside the scenario counts.

| Representative operation | DynamoDB Local calls | Items evaluated by queries | Returned capacity units |
| --- | --- | --- | --- |
| Barcode hit | 2 GetItem | 0 | 2 |
| Latest exact price hit | 1 Query | 1 | 1 |
| Base comparison, three saved shops | 1 GetItem, 4 Query | 10 | 5 |
| Same comparison, two items per page | 1 GetItem, 8 Query | 10 | 7 |
| Late historical insert | 3 GetItem, 1 TransactWriteItems | 0 | 5 |
| Repeat latest correction twice | 6 GetItem, 2 TransactWriteItems | 0 | 10 |

Concurrency can change call counts. Local capacity results are observations of
this implementation and fixture, with no managed-service cost or throughput
implication. DynamoDB Local doesn't reproduce managed transaction-conflict
exceptions, throttling, partitioning, latency or IAM enforcement.
[AWS DynamoDB Local usage notes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html)

## Production questions

- A comparison uses multiple reads without a cross-shop snapshot. A comparison
  overlapping an unlink or correction can reflect a mix of committed states.
- A large household or group increases pages, app memory and sorting work.
  Shop traffic and popular product/shop pairs could concentrate writes.
- Product comparison metadata is treated as immutable. Edits or reclassification
  would require a projection migration with an explicit cutover plan. New
  categories can reuse the model if they fit the same comparison criteria.
  Geographical discovery and nearest-shop search would need separate access
  patterns and indexes.
- The fixture covers independent and combined brand/variety filters with
  populated labels. It does not establish a rule for absent labels. The
  prototype excludes incompatible/unknown units from its ranked results.
  The app also shows those items in a separate unranked section.
- Household access control, historical correction audit, managed-service
  transaction behavior, backups and production operation remain open.
