import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { z } from 'zod';

const identity = z.object({
  CHEAPO_AWS_PROFILE: z.string().trim().regex(/^\w[\w.@ -]*$/),
  CHEAPO_AWS_REGION: z.string().regex(/^[a-z]{2}(?:-[a-z0-9]+)+-[1-9]\d*$/),
  CHEAPO_AWS_ACCOUNT_ID: z.string().regex(/^\d{12}$/),
});
const stackName = z.string().max(128).regex(/^[A-Za-z][A-Za-z0-9-]*$/);
const availabilityZone = z.string().regex(/^[a-z]{2}(?:-[a-z0-9]+)+-[1-9]\d*[a-z]$/);
const vpcId = z.string().regex(/^vpc-(?:[a-f0-9]{8}|[a-f0-9]{17})$/);
const subnetCidr = z.cidrv4().refine((cidr) => /\/(1[6-9]|2[0-8])$/.test(cidr));

const databaseIdentifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,62}$/);
const network = identity.extend({
  CHEAPO_VPC_ID: vpcId,
  CHEAPO_PRIMARY_AZ: availabilityZone,
}).refine(
  (config) => config.CHEAPO_PRIMARY_AZ.slice(0, -1) === config.CHEAPO_AWS_REGION,
  { path: ['CHEAPO_PRIMARY_AZ'] },
);

const schemas = {
  validate: identity,
  identity: identity.extend({
    CHEAPO_STORAGE_STACK_NAME: stackName,
    CHEAPO_ACCESS_STACK_NAME: stackName,
  }).refine(
    (config) => config.CHEAPO_STORAGE_STACK_NAME !== config.CHEAPO_ACCESS_STACK_NAME,
    { path: ['CHEAPO_ACCESS_STACK_NAME'] },
  ),
  storage: network.safeExtend({
    CHEAPO_DB_NAME: databaseIdentifier,
    CHEAPO_DB_USER: databaseIdentifier,
    CHEAPO_DB_SUBNET_A_CIDR: subnetCidr,
    CHEAPO_DB_SUBNET_B_CIDR: subnetCidr,
    CHEAPO_SECONDARY_AZ: availabilityZone,
  }).refine(
    (config) => config.CHEAPO_SECONDARY_AZ.slice(0, -1) === config.CHEAPO_AWS_REGION &&
      config.CHEAPO_PRIMARY_AZ !== config.CHEAPO_SECONDARY_AZ,
    { path: ['CHEAPO_SECONDARY_AZ'] },
  ).refine(
    (config) => config.CHEAPO_DB_SUBNET_A_CIDR !== config.CHEAPO_DB_SUBNET_B_CIDR,
    { path: ['CHEAPO_DB_SUBNET_B_CIDR'] },
  ),
  access: network.safeExtend({
    CHEAPO_RUNNER_SUBNET_ID: z.string().regex(/^subnet-(?:[a-f0-9]{8}|[a-f0-9]{17})$/),
    CHEAPO_DB_SECURITY_GROUP_ID: z.string().regex(/^sg-(?:[a-f0-9]{8}|[a-f0-9]{17})$/),
  }),
};

function aws(config, args) {
  const result = spawnSync('aws', [
    '--profile', config.CHEAPO_AWS_PROFILE,
    '--region', config.CHEAPO_AWS_REGION,
    '--no-cli-pager', '--no-cli-auto-prompt', ...args,
  ], { encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) {
    throw new Error(`AWS ${args[0]} ${args[1]} failed. Check CLI access and the AWS login.`);
  }
  return result.stdout.trim();
}

function check() {
  const mode = process.argv[2] ?? 'validate';
  if (!Object.hasOwn(schemas, mode) || process.argv.length > 3) {
    throw new Error('Usage: pnpm infra:aws:check [validate|identity|storage|access]');
  }

  const parsed = schemas[mode].safeParse(parse(readFileSync('infra/aws/.env.local')));
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid or missing AWS settings: ${keys.join(', ')}`);
  }

  const config = parsed.data;
  const account = aws(config, ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text']);
  if (account !== config.CHEAPO_AWS_ACCOUNT_ID) {
    throw new Error('The AWS profile does not match CHEAPO_AWS_ACCOUNT_ID.');
  }

  if (mode === 'identity') {
    console.log([
      config.CHEAPO_AWS_PROFILE,
      config.CHEAPO_AWS_REGION,
      config.CHEAPO_AWS_ACCOUNT_ID,
      config.CHEAPO_STORAGE_STACK_NAME,
      config.CHEAPO_ACCESS_STACK_NAME,
    ].join('\t'));
  } else if (mode === 'validate') {
    for (const name of ['shopping-storage', 'shopping-migration-access']) {
      aws(config, ['cloudformation', 'validate-template', '--template-body', `file://infra/aws/${name}.yaml`]);
      console.log(`Validated infra/aws/${name}.yaml`);
    }
  } else {
    const parameters = mode === 'storage' ? {
      VpcId: config.CHEAPO_VPC_ID,
      DatabaseName: config.CHEAPO_DB_NAME,
      DatabaseAdminUsername: config.CHEAPO_DB_USER,
      DatabaseSubnetACidr: config.CHEAPO_DB_SUBNET_A_CIDR,
      DatabaseSubnetBCidr: config.CHEAPO_DB_SUBNET_B_CIDR,
      PrimaryAvailabilityZone: config.CHEAPO_PRIMARY_AZ,
      SecondaryAvailabilityZone: config.CHEAPO_SECONDARY_AZ,
    } : {
      VpcId: config.CHEAPO_VPC_ID,
      RunnerSubnetId: config.CHEAPO_RUNNER_SUBNET_ID,
      PrimaryAvailabilityZone: config.CHEAPO_PRIMARY_AZ,
      DatabaseSecurityGroupId: config.CHEAPO_DB_SECURITY_GROUP_ID,
    };
    console.log(JSON.stringify(Object.entries(parameters).map(
      ([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }),
    )));
  }
}

try {
  check();
} catch (error) {
  console.error(error.code === 'ENOENT' ? 'Copy infra/aws/.env.example to infra/aws/.env.local and fill in the settings.' : error.message);
  process.exitCode = 1;
}
