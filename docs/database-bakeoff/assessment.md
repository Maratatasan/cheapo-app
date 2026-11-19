# Cheapo database bake-off

**13 November 2026 · Recommendation for owner review**

Use PostgreSQL as the default engine for Cheapo’s first shared catalog. Build behind the Cheapo API’s domain repository boundary. Confirm the hosting choice separately once the workload, selected AWS Region, project plan and budget are known. [Catalog design spike #107](https://github.com/Maratatasan/cheapo-app/issues/107) · [Local repository boundary #128](https://github.com/Maratatasan/cheapo-app/issues/128)

## Independent checks

Both prototypes passed the 34 frozen scenarios on the same Apple M1 Mac running macOS 27.2.1. The fixture covers two households, four shops, seven products and 11 initial observations. The checks use fresh databases, real concurrent writers, and the same SHA-256-verified input. Fixture history is checked as a set of complete observations because the contract specifies order for latest and comparison results. [Contract and rubric](contract.md) · [Exact fixture JSON at the verified commit](https://github.com/Maratatasan/cheapo-app/blob/661e0644334914ed473951b33571d7280f113d95/tools/database-poc/dynamodb/fixture.json)

| Prototype | Independently checked revision | Result | Repository CI |
| --- | --- | --- | --- |
| [DynamoDB PR #127](https://github.com/Maratatasan/cheapo-app/pull/127) | `661e0644334914ed473951b33571d7280f113d95` | 34/34 on DynamoDB Local 3.3.2, then 34/34 with two items per query page. Java 17.0.21.0.3, Python 3.13.3, boto3 1.43.118. | [Passed](https://github.com/Maratatasan/cheapo-app/actions/runs/43452826299) |
| [PostgreSQL PR #129](https://github.com/Maratatasan/cheapo-app/pull/129) | `c9c59ecf0caed911965b1928a6950402a8f76543` | 34/34 on native PostgreSQL 17.12 and Node 24.22.2, plus one replay-after-correction scenario. Query plans captured in a separate run. | [Passed](https://github.com/Maratatasan/cheapo-app/actions/runs/43453063248) |

Run from the matching PR checkout with each prototype’s documented local prerequisites. Set `fixture` to the same downloaded JSON for both. Its SHA-256 is `d2309e27ddcff166156693f491649814b61dbd1cd8b4ba99ebbfbad53cc30523`.

```sh
python -B tools/database-poc/dynamodb/check.py "$fixture"
python -B tools/database-poc/dynamodb/check.py "$fixture" --query-page-size 2

tools/database-poc/postgres/run.sh "$fixture"
CHEAPO_POSTGRES_PLAN=1 tools/database-poc/postgres/run.sh "$fixture"
```

Both preserved a corrected observation when the original create request was replayed. DynamoDB returned the original 190p payload and PostgreSQL returned the current 195p payload. The common contract leaves this response unspecified. Define the API response before adding offline sync so a retry cannot overwrite a correction in the client’s view. The correction itself survived in both stores.

## Observed access paths

| Operation | DynamoDB Local | PostgreSQL |
| --- | --- | --- |
| Saved shops and barcode | Household-key prefix query. Barcode hit uses two point reads. A transaction reserves barcode text and inserts the product. | Composite household/shop key and one unique text barcode index. An insert plus readback distinguishes identical replay from a conflict. |
| Latest exact price | One descending product/shop query, one returned history item. | One indexed latest-row lookup at the larger seed. At fixture size, the planner picked a sequential scan and sort. |
| Three-shop comparison | One product get and four queries, evaluating ten items and returning five local capacity units. Two-item pages used eight queries and seven local units with the same ten items. Brand and variety filters run after retrieval and leave read work unchanged. | One statement joins the saved shops and candidates. With 5,000 unrelated products and 21,000 older observations added, the plan used the comparison and latest-observation indexes. It made 12 latest-row probes for five results unfiltered and six probes for three results with both filters. The five-link table used a sequential scan. |
| Observation writes | Read product, shop and current projection, then conditionally write an observation locator and history item and replace the latest projection if eligible. A latest price correction updates history and projection transactionally. | Insert one observation row with a unique ID and foreign keys. Update the row by ID on correction. The latest-price index and queries derive current state from history. |

DynamoDB has no table scan or secondary index in this prototype. Its latest-per-product projection avoids reading history on comparisons. Work grows with saved shops, pages and candidates at those shops, and one comparison spans multiple reads. PostgreSQL uses one statement snapshot for comparison and pushes filters before the latest-row lookups in this plan. Lookup work can still grow with eligible products × saved shops, including pairs with no observed price. Neither check measured a large household or a popular, very large comparison group. The SQL test also leaves rounding at finite decimal precision, while DynamoDB’s Python adapter sorts exact rational values. The integer-price fixture does not distinguish these. [DynamoDB Local limits](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.UsageNotes.html) · [PostgreSQL statement snapshots](https://www.postgresql.org/docs/17/transaction-iso.html) · [PostgreSQL query plans](https://www.postgresql.org/docs/17/using-explain.html)

## Assessment

Scores use the predeclared 0–4 rubric and weight only this spike’s evidence. Both passed the common correctness gate.

| Criterion | Weight | PostgreSQL | DynamoDB | Rationale |
| --- | ---: | ---: | ---: | --- |
| Correctness and concurrency | 30% | 3 | 3 | Both verify private links, history, ties and concurrent retry. Managed DynamoDB conflicts are outside the emulator. End-to-end authorization and conflict/audit policy remain open for both. |
| Data access and writes | 20% | 4 | 3 | PostgreSQL demonstrates query and index behavior on fixture and expanded history with one observation row to maintain. DynamoDB avoids history reads and global scans, with per-shop query fan-out and transactional projections. |
| Schema evolution and product fit | 20% | 4 | 2 | PostgreSQL’s canonical records and joins let Cheapo change comparisons, investigate history and add membership queries from the same tables. DynamoDB needs access-pattern design and a cutover/backfill plan for changes to product fields copied into projections or new indexes. |
| Operability and cost | 15% | 2 | 3 | Both need backup/restore verification and cost modelling. DynamoDB on-demand removes instance sizing and connection pooling from this design. PostgreSQL operation depends on the selected host, connection budget and topology. |
| Reproducibility and maintenance | 15% | 3 | 3 | Each has repeatable real local checks and readable source. PostgreSQL uses stock SQL and a disposable socket cluster. DynamoDB has documented keys, capacity reporting and one-table setup, with managed transaction behavior remaining to verify. |
| **Weighted score** | | **81.25/100** | **70/100** | Local design assessment only. |

## Cheapo fit and hosting assumptions

PostgreSQL’s foreign keys keep a canonical shop separate from household nicknames and preserve shop/product references through unlink. A new comparison dimension or category can start as a schema/query change. DynamoDB can serve current fixed lookups efficiently, and it remains a credible option if real usage settles on a small set of stable key queries and sparse demand makes request pricing decisive. Geography will require new access paths in either case. PostGIS on compatible PostgreSQL hosting can support geographic filtering if it becomes useful. The planned drive-time feature still needs a routing/travel-time source. [RDS PostGIS support](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.PostGIS.html) · [Cheapo domain map](https://www.mindomo.com/mindmap/cfab54ffb4884d5f8e458a03433f8aa0)

For an eventual Stockholm comparison, model DynamoDB Standard on-demand reads and writes using real item sizes, saved-shop counts, page counts, conditional/transactional work, retries, storage and recovery. Model RDS for PostgreSQL using selected instance hours, storage, backup retention, required availability topology and any proxy or transfer charges. The fixture’s local capacity reports mix read/write units and are unsuitable for pricing. Assume neither credits nor a free entitlement. Verify the AWS project’s selected Region, plan, eligibility and limits before comparing actual regional rates or choosing a host. [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/) · [RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/) · [AWS RDS regional availability](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RegionsAndAvailabilityZones.html) · [DynamoDB regional endpoints](https://docs.aws.amazon.com/general/latest/gr/ddb.html)

Before a production backend, define trusted household membership, catalog write rights, correction audit, exact normalized ordering, missing brand/variety behavior, unranked comparisons, media authorization and sync response semantics. Measure representative history and popular categories and verify backups, failure handling and service cost under the intended host. The two POCs test local data behavior. Cloud performance, access controls, costs, availability, restore, app integration, bundle export, browser, simulator and physical-device behavior remain unverified by this bake-off.
