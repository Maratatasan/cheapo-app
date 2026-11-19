# Cheapo API

The first route stores personal comparison preferences in PostgreSQL. Each
shopper has a separate identity. Their active household membership grants access,
and their preferences are keyed by shopper and product group. A household
member cannot read or replace another member’s preference.

## Try the service locally

From the root, install with `pnpm install --frozen-lockfile`. With PostgreSQL’s
`initdb`, `pg_ctl`, `psql` and `openssl` on `PATH`, run:

```sh
pnpm --filter @cheapo/api test:postgres
```

The test creates a disposable database on a private Unix socket and starts the
API on loopback. It uses synthetic shoppers and credentials. PostgreSQL 17 is
the local development target. GitHub’s Linux runner supplies PostgreSQL 16.

For an existing **development** database, set its PostgreSQL connection settings
using the standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and `PGPASSWORD`
environment variables as needed. Apply numbered migrations in order, skipping
any already applied to that database. For an empty local database, run:

```sh
for migration in apps/api/migrations/*.sql; do
  psql -X -v ON_ERROR_STOP=1 -f "$migration" || break
done
```

Run `pnpm --filter @cheapo/api start` to start the preference API. It binds to
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

## Issue or revoke beta phone access

A trusted operator can run the credential command using an authorized
PostgreSQL connection after applying migration `003`. Use the existing
household and shopper IDs for the intended member and choose a future UTC
expiration such as a date in the format `YYYY-MM-DDTHH:MM:SSZ`.

```sh
pnpm --filter @cheapo/api exec node operator/device-credential.ts issue "$household_id" "$shopper_id" "$expires_at"
pnpm --filter @cheapo/api exec node operator/device-credential.ts revoke "$credential_id"
```

Issue a separate credential for each phone. The issue command returns the
credential ID for your revocation records and a path to a temporary delivery
file readable only by your OS user. Hand the file's contents directly to the
intended shopper through an approved private handoff and delete the file and
its temporary directory after enrollment. Keep the credential value out of
shell commands, logs, and issue reports. If delivery is interrupted or the
credential is exposed, revoke its ID and issue a replacement. Revoking one ID
preserves the member's data and other phone credentials. Checking an ID for
revocation does not require the token.

## Shopping history storage

Migration `002` adds tables for the offline restore in
[#171](https://github.com/Maratatasan/cheapo-app/issues/171). Keep the original
source IDs. A known product or branch has an optional link from an observation.
An export can carry a source ID even if the corresponding catalog or shop entry
is missing. Keep that ID and leave the link empty until the relationship can be
verified. Use the captured shop display name for history and store a household's
current nickname separately. Current shop selection requires a saved shop in
the shopper's own household.

The observation keeps the original review fields alongside the amount and
currency when they can be parsed. Its original and cropped product price photos
use references with file hashes and sizes. Photo bytes remain outside the
database. Product presentation photos have a separate lifecycle.

The PostgreSQL test runs synthetic fixtures for these relationships and the
existing preference API tests. The real collection restore is tracked in
[#171](https://github.com/Maratatasan/cheapo-app/issues/171).

### Check an offline backup before restore

Use an independently verified Cheapo ZIP from a known source. Extract it into a
private directory first, retaining `manifest.json` and its `photos` tree. Run:

```sh
pnpm --silent --filter @cheapo/api import:plan /path/to/extracted-backup
```

The planner accepts manifests v1, v2 and v3, checks their relationships and
hashes the referenced JPEG bytes. The summary shows counts and unresolved
legacy links. It does not print names, IDs, photo hashes or absolute paths. A
legacy archive can have observations without the catalog or current-shop state;
use v3 for a complete backup. The command neither writes to PostgreSQL nor
copies the original photos. Use the verified ZIP as the backup of record.

### Rehearse a restore on local PostgreSQL

Use a newly provisioned development database, apply the numbered migrations,
and provision the intended shopper and household membership. Create a separate
asset directory accessible only to your user. After validating the backup with
`import:plan`, apply it with an explicit database and owner:

```sh
PGHOST=/path/to/local/socket PGDATABASE=cheapo_dev PGUSER=cheapo_operator \
  pnpm --silent --filter @cheapo/api import:local \
  /path/to/extracted-backup /path/to/private-assets HOUSEHOLD_UUID SHOPPER_UUID
```

The restore commits the relational data in one transaction. It compares existing
rows on retries and rolls back rather than replacing conflicting data. SHA-256
identifies immutable files in the private asset directory. A failed database
transaction can leave verified files there for a retry. The command preserves
the source ZIP and the extracted files. It accepts only a local PostgreSQL
socket. Check that the reported counts match the dry-run counts and that a
second run returns the same receipt. The [Cheapo migration decision log](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit)
records the initial source and hosted target.

### Restore to a hosted database and private S3 storage

Use the reviewed PostgreSQL endpoint and photo bucket from
[#176](https://github.com/Maratatasan/cheapo-app/issues/176). Apply the numbered
migrations and provision the shopper and household membership first. Follow the
[temporary access and TLS checks](../../infra/aws/README.md#connect-and-clean-up).
Run `import:plan` on the verified extracted backup and keep its counts for
reconciliation.

Set `PGHOST` to the database DNS name, `PGPORT` if needed, `PGDATABASE`, `PGUSER`,
`PGPASSWORD` through your approved credential workflow, and `PGSSLROOTCERT` to
the trusted provider CA bundle. For an approved port forward, set
`CHEAPO_IMPORT_TUNNEL_HOST` to `127.0.0.1` and `PGPORT` to the forwarded local
port. `PGHOST` still names the real database for certificate verification.

Use the intended AWS Region and bucket owner. The import identity needs
`s3:PutObject` and `s3:GetObject` under `shopping-import/` to write and verify
photos. Supply temporary AWS credentials through the normal SDK credential
chain.

```sh
AWS_REGION=eu-north-1 CHEAPO_IMPORT_BUCKET=YOUR_PRIVATE_BUCKET \
  CHEAPO_IMPORT_BUCKET_OWNER=YOUR_AWS_PROJECT_NUMBER \
  pnpm --silent --filter @cheapo/api import:hosted \
  /path/to/extracted-backup HOUSEHOLD_UUID SHOPPER_UUID
```

S3 checks each conditional upload against the source SHA-256. The importer reads
and rehashes the stored bytes before committing their references. An existing
object with matching bytes is reusable. A mismatch stops the transaction. Photo
references are relative keys. Bucket selection and access remain in the storage
adapter. A failed transaction can leave verified objects available for retry.

Compare the restore counts with the dry run and keep the returned receipt with
the private migration record. Preserve the initial archive and reconcile later
phone changes separately before making hosted data the default. The [migration
issue](https://github.com/Maratatasan/cheapo-app/issues/171) tracks the transfer
and reconciliation.
