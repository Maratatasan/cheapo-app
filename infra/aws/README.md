# Cheapo shopping storage in Stockholm

The [private target](shopping-storage.yaml) provides the database and photo
bucket for [the shopping history migration](https://github.com/Maratatasan/cheapo-app/issues/171).
The [temporary access stack](shopping-migration-access.yaml) opens access for
one migration session. Both templates target `eu-north-1`. The guest photo
bucket and app configuration are outside these stacks.

## Review and cost

Obtain project-owner approval for the persistent storage and temporary access
before creating stacks. Use the signed-in `cheapo` profile and confirm that
`aws sts get-caller-identity` identifies Building Momentum. Check remaining
credits with `aws freetier get-account-plan-state`.

| Component | Stockholm on-demand estimate |
| --- | ---: |
| RDS PostgreSQL 17.11, Single-AZ db.t4g.micro, 730 hours | $11.68/month |
| Encrypted gp3, 20 GiB | $2.40/month |
| One RDS-managed Secrets Manager secret | $0.40/month |
| S3 Standard, 1 GB with 1,000 reads and 1,000 writes | $0.03/month |
| **Persistent total** | **$14.51/month** |
| Temporary t4g.micro with 8 GiB gp3 and one public IPv4 | **$0.35 for 24 hours** |

These are USD estimates before credits and tax. Retained S3 versions count as
stored bytes. The baseline assumes database backups fit within the included
allowance, database CPU stays within its included credits and internet
downloads fit within AWS's shared monthly transfer allowance. Public endpoints
for the application, NAT gateways and always-on runner charges are outside the
deployment. Check the details against the [Stockholm RDS rates](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/eu-north-1/index.csv),
[S3 rates](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/eu-north-1/index.csv),
[Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/),
and [IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

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

After authorization to prepare the change set, create and inspect the proposed
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
protection. Read back the database class, engine, storage, public-access flag,
seven-day backup retention and deletion protection. Check the private route
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
psql "host=$CHEAPO_DB_ENDPOINT hostaddr=127.0.0.1 port=15432 dbname=cheapo user=cheapo_admin sslmode=verify-full sslrootcert=$CHEAPO_RDS_CA_BUNDLE" \
  -c 'SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid();'
```

`hostaddr` sends traffic through the local port, and `host` supplies the
database hostname for certificate verification. Require equivalent TLS
verification in the importer before using real data. Keep stable object keys
and source hashes in the migration records. Generate any temporary read URLs
at the storage boundary.

After verifying the approved migration, close the tunnel and remove the access
stack. Verify the database ingress rule, EC2 instance and its root volume are
gone. The storage stack continues to incur charges while it is retained.
