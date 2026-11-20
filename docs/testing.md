# Cheapo testing guide

| Test type | What it checks in Cheapo |
| --- | --- |
| Smoke | The installed build is usable enough to continue. Launch it, reopen the saved sign-in, and confirm the app can read an existing product or price and retrieve its available evidence photo. |
| Integration | Real implementations work together. Exercise Cheapo’s API handlers and SQL against disposable PostgreSQL with controlled records. Where a scenario includes offline sync, exercise the real queue and retry logic. |
| Acceptance | An agreed requirement works in an observable scenario. Automate cases where practical and record what needs a hands-on check. The owner makes the final Pixel acceptance decision in [#270](https://github.com/Maratatasan/cheapo-app/issues/270). |
| Field | The app is usable during real shopping. Observe how capture, review, comparison, and saving work with actual labels, lighting, and connectivity. |

For the current Pixel rollout, run automated integration, then smoke-test the
installed build, then complete the owner’s shopping acceptance. Field use
follows the rollout and can reveal improvements for later releases.

## Mocks, fixtures and evidence

A mocked API supplies simulated responses for UI checks, such as a retry error
or an empty list. A fixture supplies known input. Synthetic records can exercise
the real handlers, queries and constraints when loaded into a real test database.

The [required CI job](../.github/workflows/ci.yml) runs
`pnpm --filter @cheapo/api test:postgres`. The [test runner](../apps/api/test/run-postgres.sh)
starts a temporary PostgreSQL instance, applies Cheapo’s migrations and runs
API, storage and two-shopper sync checks with synthetic data. Report the real
PostgreSQL coverage and any mocked boundaries in the same result. Camera,
crop and object transport doubles cover behavior at those boundaries. Verify
physical capture and crop on the device, and verify Aurora Data API and private
object reads against the hosted service. Report browser, simulator, bundle and
physical-device results separately. [CI standard](ci.md) · [UI verification](ui-verification.md)

## Live release checks

- Use restored records for read checks. Check the expected stable ID, a valid
  response structure and retrievable photo evidence when listed. Prices and
  selected photo references may change. Verify downloaded evidence against the
  hash supplied by the service. Fixed prices or photo selections belong in
  controlled fixtures.
- Keep synthetic data in UI previews, disposable local PostgreSQL and CI. Use
  ordinary live routes and read-only checks for smoke. A genuine shopping save
  or correction chosen by the owner provides live write evidence during
  [Pixel acceptance](https://github.com/Maratatasan/cheapo-app/issues/270).
  Record hosted write-failure scenarios as unverified unless rehearsed in separate staging.
- Explore Samples removal follows Pixel acceptance as part of cleanup before the
  iPhone rollout. [Release sequence](https://github.com/Maratatasan/cheapo-app/issues/184)

Record the tested revision, target, observed result, and unverified boundaries
in the issue or PR. Keep private photos, credentials, and private record details
out of shared evidence.
