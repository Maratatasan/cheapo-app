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

## Enable the Data API

Verify the assigned Region, project, and existing storage stack before any
live step. With approval, use the [storage template](shopping-storage.yaml)
to create an `UPDATE` change set for that stack. Set `EnableDataApi=true`
explicitly and use previous values for all other parameters. New storage
stacks default to `false`. On later updates preserve the stored value unless
changing it intentionally.

The expected change is an in-place update of `Database.EnableHttpEndpoint`.
Check for replacement, removals or other property changes before execution.
Confirm the endpoint is enabled after the update, the writer remains private,
and the capacity range, 15-minute idle pause, backups, and deletion protection
still match the approved storage baseline. This step leaves the phone-facing
API closed. The hosting stack does not provision or update the database.

## Reconcile the schema and restricted login

1. Identify the reviewed release commit and the existing database. Compare its
   schema and applied migration record with that release. The restored database
   already has migrations `001`–`004`. Capture counts and a private comparison
   of restored source observation keys and evidence hashes before applying new
   migrations. Keep the device routes closed while doing this work.
2. Apply only missing [reviewed migrations](../../apps/api/migrations), in
   numeric order, through the approved operator connection. For the Data API,
   use the existing administrator secret ARN. Map each file's transaction to
   `BeginTransaction` and `CommitTransaction`, and send one complete SQL
   statement per `ExecuteStatement` in that transaction. Keep a dollar-quoted
   function body together. For a statement error roll back the transaction.
   After an uncertain commit, reconcile catalog state and the migration record
   before retrying. Record the release commit, migration filename and hash,
   and verified commit outcome privately. Recheck restored keys, counts and
   hashes, plus the new resource IDs and migration-specific backfills.
3. After the migrations, reconcile the roles and function ownership. On the
   first setup run [runtime-role.sql](../../apps/api/operator/runtime-role.sql)
   once as the PostgreSQL project operator with schema ownership and role
   creation rights. It is transactional and creates `cheapo_api_runtime` and
   `cheapo_scope_guard`. If those roles exist, verify the prior bootstrap and
   apply only the reviewed grant changes required by the release. Leave both
   roles without login and the guard role unavailable for runtime assumption.
   For a release with product presentation photos, apply
   [product-presentation-photo-role.sql](../../apps/api/operator/product-presentation-photo-role.sql)
   after migration `016` and the runtime role bootstrap. Verify the scoped
   login can publish a verified revision and cannot overwrite its metadata or
   delete its receipt.
   Before deploying the handler with comparison group reads, apply migration
   `017`, then [price-observation-group-role.sql](../../apps/api/operator/price-observation-group-role.sql).
   Verify the scoped login can read the membership table and cannot write to it.
   The previous handler works with both changes applied. The new handler needs
   the table and its SELECT grant for price history reads.
4. Provision a separate PostgreSQL login that inherits only
   `cheapo_api_runtime` and store its `username` and `password` in its own
   secret using the AWS managed Secrets Manager key. Keep credentials in the
   approved secret-handling workflow and keep password values out of SQL
   files, command histories, and logs. If resuming incomplete setup, reconcile
   role and secret existence first, then verify that the intended secret can
   log in before reusing it. Check `current_user` through the scoped secret.
   Verify that login has the route permissions and cannot read credential
   digests, write memberships, or assume the guard role. Record the secret
   ARN and verification outcome privately.

## Review before publishing the HTTPS route

- Supply the existing cluster identifier and database name through approved
  private deployment settings. Supply the scoped login secret's ARN resource
  segment after `secret:` as `RuntimeSecretResource`, including its six-character
  suffix. The template derives the relevant AWS ARNs from the stack Region and
  project. Keep the administrator secret with the operator.
- Confirm the private evidence bucket and account ownership before setting
  `EvidenceBucket`. When configured, the runtime may sign reads within the
  restored `shopping-import/` prefix, sign conditional JPEG uploads in
  `price-evidence/`, and check checksum metadata and read verified evidence
  in that prefix. Product display images use the separate
  `product-presentation/` prefix with the same conditional JPEG upload and
  verified read rules. Keep the artifact prefix outside the runtime S3 grant,
  even when the two use the same bucket.
- Validate the template with a change set and inspect the scoped role and rate
  limits. Keep `PublishRoute=false` for the first approved stack change set.
  This leaves the endpoint available as an origin and does not grant API
  Gateway permission to invoke Lambda. Before publishing, use an authorized
  direct Lambda invocation with synthetic request data to check that the
  function can use its runtime secret and the deployed schema. Record
  `ApiOrigin` only after review.
- After activation approval, verify with synthetic actors before using
  restored data. Check missing, invalid, expired, and revoked credentials.
  Check two authorized shoppers and one out-of-household case. Check a cold
  request after the writer pauses, then verify it returns to idle. Confirm
  HTTPS responses and seven-day log retention. The access log uses request
  ID, route pattern, status, and latency.
- Set `PublishRoute=false` to remove invocation permission and suspend API
  calls while keeping the endpoint origin. To restore a prior compatible code
  release, set the previous reviewed artifact key and version in a change
  set. Check schema compatibility before rollback. If suspending the Data API
  as well, close the phone route first and use a reviewed storage update with
  `EnableDataApi=false` after operator work and other dependent calls finish.

Migrations, deployed Data API behavior, restored records, and the Pixel
connection each require their own verification. Local proxy tests and
CloudFormation validation cannot verify a live request.

Keep pricing assumptions, activation approval, and the cost review in the
[hosting decision log](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit).
