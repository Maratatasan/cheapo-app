# PostgreSQL proof of concept

This spike implements the frozen Cheapo database contract for the local PostgreSQL
comparison ([#126](https://github.com/Maratatasan/cheapo-app/issues/126)).

## Run locally

Use Node from the root `.nvmrc` and PostgreSQL 17 binaries (`initdb`, `pg_ctl`, and
`psql`) on your PATH. From the repository root, pass the shared frozen fixture
supplied with the bake-off. The harness verifies its SHA-256 before loading it.

```sh
nvm use
tools/database-poc/postgres/run.sh /path/to/frozen-fixture.json
CHEAPO_POSTGRES_PLAN=1 tools/database-poc/postgres/run.sh /path/to/frozen-fixture.json
```

The runner initializes a disposable cluster as the current user under a private
temporary directory, listens only on a Unix socket, and stops and removes the
cluster on exit. It needs permission to start a local PostgreSQL server. Plan
mode starts with a fresh seed, captures the baseline plans, then adds synthetic
history and unrelated products in a transaction and rolls it back after recording
the second plans. No extra JavaScript package or database driver is required.

## Tables and access paths

- A shop is shared. The household/shop primary key on `saved_shop` supports
  household-scoped listing and addresses a single link for renaming or unlinking.
  Unlinking issues one delete on the link. The observation foreign keys point to
  the shared shop and exact product.
- Product UUID and barcode have independent uniqueness constraints. PostgreSQL
  stores the barcode as text, and its unique index allows multiple nulls.
  Creation attempts one insert, then reads by UUID to distinguish replay from
  conflict. The default Read Committed isolation level lets the second statement
  see a concurrent insert after the uniqueness check resolves. A conflict returns
  SQLSTATE `23505`.
- Observations have UUID identity, an integer GBP price, a timestamp, and an
  opaque optional photo reference. A create inserts one row and checks the
  stored create payload. Original price and photo reference stay on the row so a
  retried create after correction can recognize the original request and return
  the corrected record. A correction updates the observation by primary key.
  Latest reads use `ORDER BY observed_at DESC, id DESC LIMIT 1` and can stop after
  the first matching entry in the composite B-tree. History uses the same
  product/shop predicates and returns all observations. The common history
  assertion checks membership and field values because the contract defines
  ordering for latest and comparison. The SQL history query orders timestamps
  and IDs ascending.
- Comparison is a single SQL statement. It looks up the reference product by
  UUID, joins candidates by comparison group and normalized unit, and joins the
  household's saved shops. Optional brand and variety predicates apply
  independently. A lateral lookup finds the latest observation for each
  eligible product/shop pair. PostgreSQL divides using `numeric` with extended
  decimal scale and sorts by that result, shop UUID, and product UUID before JSON
  serialization. Repeating fractions still round at PostgreSQL's finite
  division precision. The normalized units are kg, l and each. Rows in other
  dimensions and unknown units are excluded from the ranking.

The Node harness invokes repository SQL functions through `psql` and compares the
returned rows with the fixture. A concurrency barrier waits until both
independent PostgreSQL sessions are blocked on an advisory lock before releasing
them. The lock is confined to the test harness. See PostgreSQL 17 documentation
for [Read Committed](https://www.postgresql.org/docs/17/transaction-iso.html),
[insert conflicts](https://www.postgresql.org/docs/17/sql-insert.html),
[function snapshots](https://www.postgresql.org/docs/17/xfunc-volatility.html),
[advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS),
[multicolumn indexes](https://www.postgresql.org/docs/17/indexes-multicolumn.html),
and [query plans](https://www.postgresql.org/docs/17/using-explain.html).

## Local evidence

PostgreSQL 17.12, built from checksum-verified upstream source, ran natively on
arm64 macOS 27.2.1 with Node 24.22.2. All 34 frozen scenarios passed, including
four real concurrent cases. One extra check confirmed that replaying a create
after its observation was corrected preserves the correction.

`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)` reported:

| Query | Frozen seed (7 products, 11 observations) | With 5,000 unrelated products and 21,000 older observations added |
| --- | --- | --- |
| Exact latest | Sequential scan and top-N sort | `observation_latest_idx`, one output row, no sort |
| Compare all | Sequential scans and nested loops, 12 latest lookups, 5 rows sorted | Reference PK, `product_comparison_idx` bitmap scan and `observation_latest_idx`, 12 latest lookups, 5 rows sorted |
| Compare same brand and variety | 6 latest lookups, 3 rows sorted | Same indexes as unfiltered comparison, 6 latest lookups, 3 rows sorted |

The planner chose a sequential scan of the five saved links in both datasets.
The larger run tests selectivity among unrelated products and a deeper price
history. It does not model a large comparison group or large household.
The number of latest lookups can grow with eligible products × saved shops.
These are local plan observations, with timing disabled.

## Fit and limits

The same schema can store additional comparable categories and pack sizes.
Products with missing brand or variety, cross-currency prices, geographic
search, household membership enforcement, and unranked comparison rows are
outside this proof of concept. Real use would need a trusted service to derive
household identity, an authorization model for shared catalog and observation
writes, pagination for comparison and history, and correction audit rules.
The local database does not measure managed PostgreSQL latency, availability,
connection behavior, backups, or costs. No cloud deployment, app integration,
bundle export, or simulator, browser, or physical-device checks were run for
this database-only change.
