# Cheapo AWS storage

- [Storage stack](shopping-storage.yaml) creates private Aurora PostgreSQL 17.11
  Serverless v2 with one writer and a private, versioned S3 photo bucket.
- [Migration access stack](shopping-migration-access.yaml) temporarily adds a
  Systems Manager runner and its database access for [#171](https://github.com/Maratatasan/cheapo-app/issues/171).

See [D-09 in the Drive decision log](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit)
for costs, evidence, and the future API design.

## Prerequisites and validation

Use the repo's Node and pnpm versions, and put an AWS CLI with `aws login`
support on your PATH. Sign your chosen profile into Building Momentum. The
private storage stack requires the AWS Paid plan and provisioning approval.
For the import, use the
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html),
`psql`, and an [RDS CA bundle](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).

From the repo root, copy [the example](.env.example) to `infra/aws/.env.local`
and fill in the AWS profile and project account ID. Keep the Region
`eu-north-1`. Store credentials in AWS login and Secrets Manager.

```sh
pnpm infra:aws:check

cheapo_aws() {
  local cheapo_profile
  cheapo_profile=$(pnpm --silent infra:aws:check identity) || return
  aws --profile "$cheapo_profile" --region eu-north-1 --no-cli-pager "$@"
}
storage_stack=cheapo-shopping-storage
access_stack=cheapo-shopping-migration-access
```

The validation command checks project identity and both templates. The shell
helper uses that verified profile for each manual AWS command.

## Deploy approved stacks

Confirm spend settings before creating changes. In the local file, set
`CHEAPO_VPC_ID` and two distinct unused database subnet CIDRs within that VPC.
Start with the storage stack. Create migration access only when the import is
ready.

```sh
cheapo_storage_parameters=$(pnpm --silent infra:aws:check storage) &&
cheapo_aws cloudformation create-change-set --stack-name "$storage_stack" \
  --change-set-name initial --change-set-type CREATE \
  --template-body file://infra/aws/shopping-storage.yaml \
  --parameters "$cheapo_storage_parameters"
```

For each created change set, set `stack` to the corresponding stack name and
inspect the proposed changes. Run execution only after review and approval.

```sh
stack="$storage_stack" # Use "$access_stack" when reviewing the runner.
cheapo_aws cloudformation wait change-set-create-complete --stack-name "$stack" --change-set-name initial
cheapo_aws cloudformation describe-change-set --stack-name "$stack" --change-set-name initial
```

```sh
cheapo_aws cloudformation execute-change-set --stack-name "$stack" --change-set-name initial
cheapo_aws cloudformation wait stack-create-complete --stack-name "$stack"
cheapo_aws cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].Outputs'
```

Enable termination protection on the storage stack. Verify the writer has no
public access, the DB subnets have no internet route, and database ingress is
closed before adding migration access. Check encryption, seven-day backups,
deletion protection, and S3 public-access blocking, versioning and TLS policy.

```sh
cheapo_aws cloudformation update-termination-protection --stack-name "$storage_stack" --enable-termination-protection
```

In the local file, set `CHEAPO_DB_SECURITY_GROUP_ID` from the storage stack's
`DatabaseSecurityGroupId`. Set `CHEAPO_RUNNER_SUBNET_ID` to a same-VPC subnet
in `eu-north-1a` with an internet gateway route. Create, review and execute
the access change set using the same steps above with `stack="$access_stack"`.

```sh
cheapo_access_parameters=$(pnpm --silent infra:aws:check access) &&
cheapo_aws cloudformation create-change-set --stack-name "$access_stack" \
  --change-set-name initial --change-set-type CREATE --capabilities CAPABILITY_IAM \
  --template-body file://infra/aws/shopping-migration-access.yaml \
  --parameters "$cheapo_access_parameters"
```

## Connect and clean up

Set `CHEAPO_RUNNER_ID` from `RunnerInstanceId`, `CHEAPO_DB_ENDPOINT` from
`DatabaseEndpoint`, and `CHEAPO_RDS_CA_BUNDLE` to the local CA file.
The runner accepts zero incoming connections. Keep secrets on the operator's
machine and enter the database password at the `psql` prompt.

```sh
cheapo_aws ssm start-session --target "$CHEAPO_RUNNER_ID" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$CHEAPO_DB_ENDPOINT,portNumber=5432,localPortNumber=15432"
```

In a second terminal with the same connection variables, confirm TLS before
importing data. Keep hostname verification enabled in the importer.

```sh
psql "host=$CHEAPO_DB_ENDPOINT hostaddr=127.0.0.1 port=15432 dbname=cheapo user=cheapo_admin connect_timeout=30 sslmode=verify-full sslrootcert='$CHEAPO_RDS_CA_BUNDLE'" \
  -c 'SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid();'
```

After verifying the import, close sessions and delete only the access stack.

```sh
cheapo_aws cloudformation delete-stack --stack-name "$access_stack"
cheapo_aws cloudformation wait stack-delete-complete --stack-name "$access_stack"
```

Verify the runner, root disk, and database ingress rule are gone. The writer
scales from 0 to 1 ACU and pauses after 15 idle minutes. Check that it returns
to 0 ACU with sessions closed. Polling, open connections and RDS Proxy can keep
it awake. Storage and backups persist and can incur charges while it sleeps.
Keep the Aurora cluster, photo bucket and bucket policy protected. Review the
backup and restore plan before retiring persistent storage.
