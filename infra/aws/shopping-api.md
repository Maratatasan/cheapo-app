# Shopping API hosting

The prepared stack serves the same shopping routes as the local PostgreSQL
service. HTTP API forwards only `/v1/*` to an on-demand Node.js Lambda. The app
validates the device bearer credential and household access. The gateway
adapter caps request metadata at 256 KiB before app routing. Photo bytes use
separate object transfer. Lambda uses the
Aurora Data API and stays outside the private database network. The cluster
and photo bucket retain their existing network and public access rules.

## Prepare the release

From the repository root, on the approved commit, build and test the artifact
locally with the Node and pnpm versions recorded in the repository.

```sh
pnpm --filter @cheapo/api build:hosted
(cd apps/api/dist/hosted && zip -qX ../shopping-api.zip index.js)
shasum -a 256 apps/api/dist/shopping-api.zip
```

The archive contains the bundled API. Record its exact commit and SHA-256.
Once artifact upload is authorized, put it in a versioned private artifact
bucket in the assigned Region. Keep the previous key and version available
for rollback. Record the reviewed artifact key, version ID, and SHA-256
together in the release record.

## Review before activating

- Verify the assigned Region and project before any live step. Supply the
  existing cluster identifier and database name through approved private
  deployment settings. The template derives the relevant AWS ARNs from the
  stack Region and project.
- Prepare a restricted PostgreSQL login and a separate secret using the AWS
  managed Secrets Manager key. Supply only the secret's ARN resource segment
  after `secret:` as `RuntimeSecretResource`. Verify it includes the six
  character suffix and denotes the scoped login. Verify the runtime login
  cannot create, revoke, or alter shopper credentials or memberships. Leave the
  database administrator secret with the operator. Confirm the restored database's
  applied migrations and apply only new reviewed migrations in order. Record
  each applied revision and reconcile the existing observation IDs, photo hashes,
  and row counts. Then apply the [runtime role grants](../../apps/api/operator/runtime-role.sql)
  using an operator login with schema ownership and role creation rights.
  Grant `cheapo_api_runtime` to the separate login. Keep the internal
  `cheapo_scope_guard` role unavailable for login or runtime assumption.
  The SQL grants cover the current API routes. Review grants again when a
  route adds a database operation.
- The cluster must have its Data API endpoint enabled for this stack. Obtain
  approval for that change separately. Keep the database private and preserve
  its existing capacity and 15-minute idle pause settings. Confirm the role
  setup and route migrations before activating. The stack does not modify the
  storage stack or provision a database.
- Confirm the private evidence bucket and account ownership before setting
  `EvidenceBucket`. When configured, the runtime may sign reads within the
  restored `shopping-import/` prefix and sign conditional JPEG uploads in
  `price-evidence/`. Keep the artifact prefix outside the runtime S3 grant,
  even when the two use the same bucket. Review the object verification
  flow before activating uploads.
- Validate the template with a change set and inspect the scoped role and rate
  limits. Keep `PublishRoute=false` for the first approved stack change set.
  This leaves the endpoint available as an origin and does not grant API
  Gateway permission to invoke Lambda. Record `ApiOrigin` only after review.
- After activation approval, verify with synthetic actors before using
  restored data. Check missing, invalid, expired, and revoked credentials.
  Check two authorized shoppers and one out-of-household case. Check a cold
  request after the writer pauses, then verify it returns to idle. Confirm
  HTTPS responses and seven-day log retention. The access log uses request
  ID, route pattern, status, and latency.
- Set `PublishRoute=false` to remove invocation permission and suspend API
  calls while keeping the endpoint origin. To restore a prior compatible code
  release, set the previous reviewed artifact key and version in a change
  set. Check schema compatibility before rollback. Do not remove the private
  database or photo bucket as part of API rollback.

Migrations, deployed Data API behavior, restored records, and the Pixel
connection each require their own verification. Local proxy tests and
CloudFormation validation cannot verify a live request.

Keep pricing assumptions, activation approval, and the cost review in the
[hosting decision log](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit).
