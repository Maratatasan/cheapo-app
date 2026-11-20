# Shopping API hosting

The prepared stack serves the same shopping routes as the local PostgreSQL
service. HTTP API forwards only `/v1/*` to an on-demand Node.js Lambda. The app
validates the device bearer credential and household access. Lambda uses the
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
  database administrator secret with the operator.
- The cluster must have its Data API endpoint enabled for this stack. Obtain
  approval for that change separately. Keep the database private and preserve
  its existing capacity and 15-minute idle pause settings. Confirm the role
  setup and route migrations before activating. The stack does not modify the
  storage stack or provision a database.
- Check the hosted photo contract and scoped object permissions before enabling
  photo routes. This template grants no S3 data permissions to the runtime.
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

## Planning estimate

At 10,000 HTTP requests per month, an average half-second request on a 256 MB
ARM function, six metered Aurora Data API units per request, one secret with
up to six reads per request, and 10 MB of logs, the estimated incremental API
cost is **US$0.76 per month** before credits and tax.

| Usage | Monthly estimate |
| --- | ---: |
| HTTP API requests | $0.011 |
| Lambda requests and compute | $0.019 |
| Aurora Data API calls | $0.024 |
| One secret and up to 60,000 reads | $0.700 |
| Logs, including short retention | $0.005 |

Data API metering counts 32 KB units. Results larger than a unit can cost
more. This estimate excludes Aurora writer awake time, database and S3
storage, photo requests and transfer, artifact storage, and shared charges
from outside this workload. The pause setting stays at 15 minutes. Separate
cold sessions can keep the writer awake after each shopper visit. As an
example, 40 distinct 15-minute idle tails at 0.5 ACU and US$0.14 per ACU-hour
cost about US$0.70, plus active database time. The full monthly bill depends
on actual usage. Treat throttling and reserved concurrency as request
limits and review the project spend controls before activation.

Regional public price lists used in the estimate are
[API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/eu-north-1/index.json),
[Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/eu-north-1/index.json),
[Aurora](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/eu-north-1/index.json),
[Secrets Manager](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/eu-north-1/index.json),
and [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/eu-north-1/index.json).
