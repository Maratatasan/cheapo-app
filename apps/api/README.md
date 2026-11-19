# Cheapo API

The first route stores personal comparison preferences in PostgreSQL. Each
shopper has a separate identity. Their active household membership grants access,
and their preferences are keyed by shopper and product group. A household
member cannot read or replace another member’s preference.

## Try the service locally

From the root, install with `pnpm install --frozen-lockfile`. With PostgreSQL’s
`initdb`, `pg_ctl` and `psql` on `PATH`, run:

```sh
pnpm --filter @cheapo/api test:postgres
```

The test creates a disposable database on a private Unix socket and starts the
API on loopback. It uses synthetic shoppers and credentials. PostgreSQL 17 is
the local development target. GitHub’s Linux runner supplies PostgreSQL 16.

For an existing **development** database, set its PostgreSQL connection settings
using the standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and `PGPASSWORD`
environment variables as needed. Apply the migration with `psql -X -v
ON_ERROR_STOP=1 -f apps/api/migrations/001-comparison-preferences.sql`, then run
`pnpm --filter @cheapo/api start`. The development server binds to
`127.0.0.1:8787`. See the [test fixture](test/preferences.postgres.ts) for the
shopper, membership and credential rows a trusted operator provisions.

## Comparison preference contract

Use `/v1/me/comparison-preferences/{productGroupId}` with an authorization header
`Bearer <Cheapo credential>`. The group ID is a case-sensitive, URL-encoded
identifier. Use the same ID across devices. A preference has one of the bases
`kg`, `100g`, `litre`, `100mL`, `item`, or `wash`. The phone will use confirmed
package measures to decide which choices it offers.

| Method | Request | Successful reply |
| --- | --- | --- |
| GET | No body | `200 {"basis":"wash"}` or `200 {"basis":null}` |
| PUT | `Content-Type: application/json` and `{"basis":"wash"}` | `200 {"basis":"wash"}` |
| DELETE | No body | `200 {"basis":null}` |

The client uses the shared group default when the basis is `null`. Replacement
and clearing are idempotent. For different choices written concurrently for
one shopper and group, the last committed mutation wins. The client should
serialize edits for that group. Malformed requests get `400`, missing or
invalid credentials get `401`, and a valid credential with revoked household
membership gets `403`. Retry a `503` when the service is reachable.

The credential format is `cheapo_` followed by 32 random bytes encoded as
base64url. The database keeps its SHA-256 digest, expiration and revocation
state. An operator issues a credential for a specific active membership. The
client must keep it in protected device storage and send it over HTTPS in a
hosted deployment. Cheapo credentials are separate from ChatGPT sign-in.

Phone enrollment, hosting and the comparison selector are follow-up work in
[#147](https://github.com/Maratatasan/cheapo-app/issues/147) and
[#150](https://github.com/Maratatasan/cheapo-app/issues/150). The service has no
shop, price or photo operations in this slice.
