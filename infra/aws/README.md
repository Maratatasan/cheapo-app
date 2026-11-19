# Cheapo shopping storage in Stockholm

The [private target](shopping-storage.yaml) provides Aurora PostgreSQL
Serverless v2 and a private S3 photo bucket for
[the shopping history migration](https://github.com/Maratatasan/cheapo-app/issues/171).
The [temporary access stack](shopping-migration-access.yaml) gives the offline
importer one migration session. Both templates target `eu-north-1`. The guest
photo bucket and current app configuration are outside these stacks. See the
[hosting decision](decision.md) for the cost review and switching criteria.

## Review and cost

The current Building Momentum project is on the AWS Free plan. The signed-in
inventory showed $100 remaining and scheduled expiry on 10 May 2027, or sooner
if spent. [Free-plan Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-free-tier.html)
requires [Express configuration](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_GettingStartedAurora.AuroraPostgreSQL.ExpressConfig.html),
whose IAM-authenticated internet PostgreSQL gateway cannot be turned off.
This private VPC proposal needs a Paid-plan decision and explicit provisioning
approval. The plan upgrade and resource creation are separate owner decisions.
Confirm the assigned Region, current credits, and project spend limit in
[AWS Settings](https://settings.aws.com/) before either action.

The target is Aurora PostgreSQL 17.11 with Aurora Standard storage, a single
private writer, 0–1 ACU, and a 900-second idle pause. The Stockholm engine
inventory lists 17.11 with a zero minimum and the `db.serverless` class.
One writer avoids a second compute bill and is a beta trade-off. The storage
layer remains redundantly stored across availability zones.

| Component | Illustrative monthly cost before credits and tax |
| --- | ---: |
| Aurora compute at $0.14 per ACU-hour | $0.70 at 5 ACU-hours or $4.20 at 30 ACU-hours |
| Aurora storage, 1 GiB consumed at $0.11 per GiB-month | $0.11 |
| Aurora Standard storage I/O, 1 million at $0.21 per million | $0.21 |
| Seven-day backups within included allowance | $0.00 |
| Backup storage above allowance | $0.02 per additional GiB-month |
| Secrets Manager, 2 secrets, up to 10,000 billed requests | $0.85 |
| S3 Standard, 1 GB and 1,000 writes and reads each | $0.03 |
| HTTP API Gateway, 4,000 requests at $1.06 per million | <$0.01 |
| Lambda Arm64, 4,000 invocations at 256 MiB for 0.2 seconds | <$0.01 |
| RDS Data API, 10,000 billable 32 KiB units at $0.35 per million | <$0.01 |
| Cognito Essentials, up to 10,000 active direct or social users | $0.00 |
| CloudWatch, 0.1 GB ingested and 0.1 GB retained | $0.06 |
| Internet downloads within the shared 100 GB monthly allowance | $0.00 |
| **Illustrative total** | **About $2.00–$5.50/month** |

Five ACU-hours assumes one separate 5-minute shopping session daily, a
15-minute pause timer per session, and 0.5 ACU while awake. Thirty ACU-hours
assumes four separate 15-minute sessions daily and 0.5 ACU while awake. These
are models of quiet or bursty usage, not measured costs or limits.
If continuously awake, 0.5 ACU costs **$51.10/month in compute alone** at
730 hours. Continuously at the configured 1 ACU maximum would be
**$102.20/month in compute alone**. Storage, I/O, backup, credential, and API
usage remain separate. Allow for occasional maintenance wake-ups. Keep
database polling, persistent application sessions, and RDS Proxy out of the
design so the writer can pause. Monitor actual ACU use before expanding beta
access. No alert exists until configured.

The model includes future API and auth allowances; those services are outside
the initial storage stack. The optional migration runner is about **$0.35 per
24 hours**, including its disk and temporary public IPv4. Cognito's estimate
uses native or social accounts and excludes SMS and an external mail service.
The S3 estimate includes retained object bytes and assumes few downloads.
AWS charges for additional data transfer if the shared allowance is exhausted.

[Aurora rates](https://aws.amazon.com/rds/aurora/pricing/) ·
[Stockholm DB price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/eu-north-1/index.csv) ·
[Auto-pause behavior](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html) ·
[API Gateway](https://aws.amazon.com/api-gateway/pricing/) ·
[Lambda](https://aws.amazon.com/lambda/pricing/) ·
[Cognito](https://aws.amazon.com/cognito/pricing/) ·
[CloudWatch](https://aws.amazon.com/cloudwatch/pricing/) ·
[S3](https://aws.amazon.com/s3/pricing/) ·
[Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) ·
[IPv4](https://aws.amazon.com/vpc/pricing/)

## App access after the migration

Use an HTTPS API Gateway HTTP API with a Cognito JWT authorizer and
an on-demand Lambda outside the VPC. Turn off self-sign-up and invite through
the administrator. Use the signed identity to resolve household membership in
the API on each request. The mobile app keeps its current local stores during
migration. It receives neither database credentials nor AWS access keys.

Add a least-privilege PostgreSQL role and its own Secrets Manager secret when
the API is implemented. Enable Data API on the private cluster in that work.
The Lambda role can execute statements against that cluster with the application
secret. Keep the master secret for maintenance. Data API is supported in
Stockholm for this version and reaches the private database without a NAT or
proxy. Give the API access to its approved S3 prefix and mint short-lived URLs
for authorized photo transfers. Persist object keys and hashes.

Data API wakes the writer, and the first operation can return
`DatabaseResumingException`. Use bounded delayed retries for that condition.
The API Gateway HTTP integration has a 30-second timeout. Return a retryable
response before that limit if the database is still waking. Keep photo and
price mutations repeat-safe across any timeout or retry. Verify first-use
latency after idle, normal authorized reads and writes, household isolation,
and an actual return to 0 ACU on the deployed beta before widening access.

[Data API regions](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.Aurora_Fea_Regions_DB-eng.Feature.Data_API.html) ·
[Data API resume error](https://docs.aws.amazon.com/rdsdataservice/latest/APIReference/API_ExecuteStatement.html) ·
[HTTP API limits](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)

## Validate and review the changes

Run the commands from the repository root with a current AWS CLI. The following
commands use zsh or Bash.

```sh
cheapo_aws() { aws --profile cheapo --region eu-north-1 --no-cli-pager "$@"; }

cheapo_aws cloudformation validate-template \
  --template-body file://infra/aws/shopping-storage.yaml
cheapo_aws cloudformation validate-template \
  --template-body file://infra/aws/shopping-migration-access.yaml
```

Before proposing the change set, read the existing VPC and subnet routes.
Choose two unused CIDR ranges within that VPC for the database. Select the
runner subnet in `eu-north-1a` with an internet gateway route and confirm it
belongs to the same VPC. Supply these values from the project inventory
as `CHEAPO_VPC_ID`, `CHEAPO_DB_SUBNET_A_CIDR`, `CHEAPO_DB_SUBNET_B_CIDR`
and `CHEAPO_RUNNER_SUBNET_ID` in your shell.

After the owner authorizes provisioning and the project is on its approved
Paid plan, confirm no storage stack exists, then create and inspect the proposed
storage changes. Executing this change set starts the storage charges.

```sh
cheapo_aws cloudformation create-change-set \
  --stack-name cheapo-shopping-storage --change-set-name initial-storage \
  --change-set-type CREATE --template-body file://infra/aws/shopping-storage.yaml \
  --parameters ParameterKey=VpcId,ParameterValue="$CHEAPO_VPC_ID" \
    ParameterKey=DatabaseSubnetACidr,ParameterValue="$CHEAPO_DB_SUBNET_A_CIDR" \
    ParameterKey=DatabaseSubnetBCidr,ParameterValue="$CHEAPO_DB_SUBNET_B_CIDR"
cheapo_aws cloudformation wait change-set-create-complete \
  --stack-name cheapo-shopping-storage --change-set-name initial-storage
cheapo_aws cloudformation describe-change-set \
  --stack-name cheapo-shopping-storage --change-set-name initial-storage
```

Review the resource additions and service validation before execution. With
approval, execute the reviewed change set and enable stack termination
protection. Read back the cluster engine, encrypted Aurora Standard storage,
seven-day backups, deletion protection, and the 0–1 ACU and 900-second pause
settings. Confirm the cluster has one `db.serverless` writer with public
access disabled. Check the private route
table and absence of database ingress rules, then check the bucket's public
access block, ownership, encryption, versioning and TLS-only policy. Read the
actual database and bucket identifiers from stack outputs. Keep the retained
database, bucket and bucket policy under documented ownership if the storage
stack is ever retired.

## Connect for an approved import

Create the access stack only when the migration is ready. Review its
CloudFormation change set before execution. It requires `CAPABILITY_IAM` to
register the temporary EC2 instance in Systems Manager. Use the deployed
`DatabaseSecurityGroupId` output as `CHEAPO_DB_SECURITY_GROUP_ID`.

```sh
cheapo_aws cloudformation create-change-set \
  --stack-name cheapo-shopping-migration-access --change-set-name initial-access \
  --change-set-type CREATE --template-body file://infra/aws/shopping-migration-access.yaml \
  --capabilities CAPABILITY_IAM \
  --parameters ParameterKey=VpcId,ParameterValue="$CHEAPO_VPC_ID" \
    ParameterKey=RunnerSubnetId,ParameterValue="$CHEAPO_RUNNER_SUBNET_ID" \
    ParameterKey=DatabaseSecurityGroupId,ParameterValue="$CHEAPO_DB_SECURITY_GROUP_ID"
cheapo_aws cloudformation wait change-set-create-complete \
  --stack-name cheapo-shopping-migration-access --change-set-name initial-access
cheapo_aws cloudformation describe-change-set \
  --stack-name cheapo-shopping-migration-access --change-set-name initial-access
```

The runner opens outbound HTTPS to Systems Manager and PostgreSQL to the database
security group. It accepts no incoming connections and has no permissions to read
the database secret or photo bucket. Keep the import operator and credentials
on the local machine. Use a local [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
for the tunnel. Set `CHEAPO_RUNNER_ID` from the access stack output and
`CHEAPO_DB_ENDPOINT` from the storage stack output. Start the tunnel in its own
terminal.

```sh
cheapo_aws ssm start-session --target "$CHEAPO_RUNNER_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$CHEAPO_DB_ENDPOINT,portNumber=5432,localPortNumber=15432"
```

Download the [RDS CA bundle](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
to a local path `CHEAPO_RDS_CA_BUNDLE`. Use the RDS-managed password via
`psql`'s interactive prompt. Keep the password out of shell commands and logs.

```sh
psql "host=$CHEAPO_DB_ENDPOINT hostaddr=127.0.0.1 port=15432 dbname=cheapo user=cheapo_admin connect_timeout=30 sslmode=verify-full sslrootcert=$CHEAPO_RDS_CA_BUNDLE" \
  -c 'SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid();'
```

`hostaddr` sends traffic through the local port, and `host` supplies the
database hostname for certificate verification. Set a 30-second connection
timeout and allow for a longer resume after prolonged idle. Require equivalent
TLS verification in the importer before using real data. Keep stable object keys
and source hashes in the migration records. Generate any temporary read URLs
at the storage boundary.

After verifying the approved migration, close the tunnel and remove the access
stack. Verify the database ingress rule, EC2 instance and its root volume are
gone. Close remaining database sessions and observe a drop to zero when idle.
The storage stack retains the database and photos while the writer is paused.
