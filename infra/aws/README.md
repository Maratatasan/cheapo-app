# Cheapo AWS storage

- [Storage stack](shopping-storage.yaml) creates private Aurora PostgreSQL 17.11
  Serverless v2 with one writer and a private, versioned S3 photo bucket.
- [Migration access stack](shopping-migration-access.yaml) temporarily adds a
  Systems Manager runner and its database access for [#171](https://github.com/Maratatasan/cheapo-app/issues/171).
- [Shopping API hosting](shopping-api.md) describes the separate reviewed HTTPS service and activation gate.

See [D-09 in the Drive decision log](https://docs.google.com/document/d/1RiVeT6NU-aVZa9y-uvB5qSQ1OYPbxUB8tzFhrNS7Z84/edit)
for costs, evidence, and the future API design.

## Prerequisites and validation

Use the repo's Node and pnpm versions, and put an AWS CLI with `aws login`
support on your PATH. Sign the selected profile into the intended AWS project.
The private storage stack requires the AWS Paid plan and provisioning approval.
For the import, use the
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html),
`psql`, and an [RDS CA bundle](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).

From the repo root, copy [the example](.env.example) to `infra/aws/.env.local`
and fill in the selected profile, expected account ID, assigned Region, and
distinct stack names. Use the project's assigned Region. Store credentials in
AWS login and Secrets Manager. Changing a stack name selects another stack.

```sh
pnpm infra:aws:check

cheapo_settings=$(pnpm --silent infra:aws:check identity) &&
  IFS=$'\t' read -r cheapo_profile cheapo_region cheapo_account storage_stack access_stack <<< "$cheapo_settings"

cheapo_aws() {
  local current_settings
  current_settings=$(pnpm --silent infra:aws:check identity) || return
  if [ "$current_settings" != "${cheapo_settings:-}" ]; then
    printf '%s\n' 'Reload the AWS settings before continuing.' >&2
    return 1
  fi
  aws --profile "$cheapo_profile" --region "$cheapo_region" --no-cli-pager "$@"
}
```

Validation checks project identity and both templates. Rerun the setup block
after changing the local settings.

New storage stacks default to `EnableDataApi=false`. For an existing stack,
follow the [hosting activation procedure](shopping-api.md#enable-the-data-api)
to review a storage update. Preserve the deployed parameter on later storage
updates unless changing the endpoint is part of the review.

## Deploy approved stacks

Confirm spend settings before creating changes. In the local file, set
`CHEAPO_DB_NAME` and `CHEAPO_DB_USER` for the initial database and admin role.
Set `CHEAPO_VPC_ID`, two zones in the assigned Region, and two distinct unused
CIDRs in that VPC. Start with storage and add migration access when ready.

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
`DatabaseSecurityGroupId`. Check `CHEAPO_PRIMARY_AZ` matches the
`DatabaseAvailabilityZone` output. Set `CHEAPO_RUNNER_SUBNET_ID` to an existing
same-VPC subnet in that zone with an internet gateway route. Follow the same
change-set review and execution steps with `stack="$access_stack"`.

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

In a second terminal, set the same connection variables and fill in
`CHEAPO_DB_NAME` and `CHEAPO_DB_USER` from the deployed database settings.
Confirm TLS before importing data. Keep hostname verification enabled in the
importer.

```sh
psql "host=$CHEAPO_DB_ENDPOINT hostaddr=127.0.0.1 port=15432 dbname='$CHEAPO_DB_NAME' user='$CHEAPO_DB_USER' connect_timeout=30 sslmode=verify-full sslrootcert='$CHEAPO_RDS_CA_BUNDLE'" \
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
