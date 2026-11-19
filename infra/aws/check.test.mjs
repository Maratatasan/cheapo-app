import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check.mjs', import.meta.url));
const account = '123456789012';
const identity = [
  'CHEAPO_AWS_PROFILE=cheapo-dev',
  'CHEAPO_AWS_REGION=eu-north-1',
  `CHEAPO_AWS_ACCOUNT_ID=${account}`,
].join('\n');

function run(t, mode, config, returnedAccount = account) {
  const cwd = mkdtempSync(join(tmpdir(), 'cheapo-infra-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const bin = join(cwd, 'bin');
  mkdirSync(bin);
  mkdirSync(join(cwd, 'infra/aws'), { recursive: true });
  if (config !== undefined) {
    writeFileSync(join(cwd, 'infra/aws/.env.local'), config);
  }
  writeFileSync(join(bin, 'aws'), `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync('aws-calls.jsonl', JSON.stringify(args) + '\\n');
if (args.includes('get-caller-identity')) console.log(process.env.TEST_AWS_ACCOUNT);
`, { mode: 0o700 });

  const result = spawnSync(process.execPath, [script, mode], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin + delimiter + process.env.PATH, TEST_AWS_ACCOUNT: returnedAccount },
  });
  const log = join(cwd, 'aws-calls.jsonl');
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { ...result, calls };
}

test('requires the dedicated local file before calling AWS', (t) => {
  const result = run(t, 'validate');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Copy infra\/aws\/\.env\.example/);
  assert.deepEqual(result.calls, []);
});

test('rejects a wrong Region without printing the invalid value or calling AWS', (t) => {
  const result = run(t, 'validate', identity.replace('eu-north-1', 'wrong-region'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHEAPO_AWS_REGION/);
  assert.doesNotMatch(result.stderr, /wrong-region/);
  assert.deepEqual(result.calls, []);
});

test('validates both templates with the selected profile and identity settings alone', (t) => {
  const result = run(t, 'validate', identity);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.map((call) => call.slice(6, 8)), [
    ['sts', 'get-caller-identity'],
    ['cloudformation', 'validate-template'],
    ['cloudformation', 'validate-template'],
  ]);
  assert.ok(result.calls.every((call) => call[1] === 'cheapo-dev' && call[3] === 'eu-north-1'));
  assert.deepEqual(result.calls.slice(1).map((call) => call.at(-1)), [
    'file://infra/aws/shopping-storage.yaml',
    'file://infra/aws/shopping-migration-access.yaml',
  ]);
});

test('rejects a profile logged into a different project before validating templates', (t) => {
  const result = run(t, 'validate', identity, '210987654321');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match CHEAPO_AWS_ACCOUNT_ID/);
  assert.doesNotMatch(result.stderr, /210987654321/);
  assert.equal(result.stdout, '');
  assert.equal(result.calls.length, 1);
});

test('checks storage network inputs before requesting AWS identity', (t) => {
  const result = run(t, 'storage', `${identity}
CHEAPO_VPC_ID=vpc-0123456789abcdef0
CHEAPO_DB_SUBNET_A_CIDR=not-a-cidr`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHEAPO_DB_SUBNET_A_CIDR/);
  assert.match(result.stderr, /CHEAPO_DB_SUBNET_B_CIDR/);
  assert.doesNotMatch(result.stderr, /not-a-cidr/);
  assert.deepEqual(result.calls, []);
});

test('outputs only storage parameters after verifying the requested project', (t) => {
  const result = run(t, 'storage', `${identity}
CHEAPO_VPC_ID=vpc-0123456789abcdef0
CHEAPO_DB_SUBNET_A_CIDR=10.0.16.0/24
CHEAPO_DB_SUBNET_B_CIDR=10.0.32.0/24
CHEAPO_PRIMARY_AZ=eu-north-1c
CHEAPO_SECONDARY_AZ=eu-north-1a`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { ParameterKey: 'VpcId', ParameterValue: 'vpc-0123456789abcdef0' },
    { ParameterKey: 'DatabaseSubnetACidr', ParameterValue: '10.0.16.0/24' },
    { ParameterKey: 'DatabaseSubnetBCidr', ParameterValue: '10.0.32.0/24' },
    { ParameterKey: 'PrimaryAvailabilityZone', ParameterValue: 'eu-north-1c' },
    { ParameterKey: 'SecondaryAvailabilityZone', ParameterValue: 'eu-north-1a' },
  ]);
  assert.equal(result.calls.length, 1);
});

test('outputs access parameters independently of storage subnet CIDRs', (t) => {
  const result = run(t, 'access', `${identity}
CHEAPO_VPC_ID=vpc-0123456789abcdef0
CHEAPO_RUNNER_SUBNET_ID=subnet-0123456789abcdef0
CHEAPO_PRIMARY_AZ=eu-north-1c
CHEAPO_DB_SECURITY_GROUP_ID=sg-0123456789abcdef0`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    { ParameterKey: 'VpcId', ParameterValue: 'vpc-0123456789abcdef0' },
    { ParameterKey: 'RunnerSubnetId', ParameterValue: 'subnet-0123456789abcdef0' },
    { ParameterKey: 'PrimaryAvailabilityZone', ParameterValue: 'eu-north-1c' },
    { ParameterKey: 'DatabaseSecurityGroupId', ParameterValue: 'sg-0123456789abcdef0' },
  ]);
  assert.equal(result.calls.length, 1);
});

test('prints one verified settings row without splitting spaces in the profile', (t) => {
  const result = run(t, 'identity', `${identity.replace('cheapo-dev', 'cheapo operator')}
CHEAPO_STORAGE_STACK_NAME=example-storage
CHEAPO_ACCESS_STACK_NAME=example-access`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\t'), [
    'cheapo operator', 'eu-north-1', account, 'example-storage', 'example-access',
  ]);
  assert.equal(result.calls[0][1], 'cheapo operator');
  assert.equal(result.calls.length, 1);
});

test('rejects matching stack names before contacting AWS', (t) => {
  const result = run(t, 'identity', `${identity}
CHEAPO_STORAGE_STACK_NAME=example
CHEAPO_ACCESS_STACK_NAME=example`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHEAPO_ACCESS_STACK_NAME/);
  assert.deepEqual(result.calls, []);
});

test('rejects matching database zones before contacting AWS', (t) => {
  const result = run(t, 'storage', `${identity}
CHEAPO_VPC_ID=vpc-0123456789abcdef0
CHEAPO_DB_SUBNET_A_CIDR=10.0.16.0/24
CHEAPO_DB_SUBNET_B_CIDR=10.0.32.0/24
CHEAPO_PRIMARY_AZ=eu-north-1c
CHEAPO_SECONDARY_AZ=eu-north-1c`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHEAPO_SECONDARY_AZ/);
  assert.deepEqual(result.calls, []);
});

test('rejects an invalid account ID without contacting AWS or echoing the value', (t) => {
  const result = run(t, 'validate', identity.replace(account, 'not-an-account'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CHEAPO_AWS_ACCOUNT_ID/);
  assert.doesNotMatch(result.stderr, /not-an-account/);
  assert.deepEqual(result.calls, []);
});
