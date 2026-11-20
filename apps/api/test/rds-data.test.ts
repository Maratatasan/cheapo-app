import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  DatabaseResumingException,
  ExecuteStatementCommand,
  type RDSDataClient,
  RollbackTransactionCommand,
} from '@aws-sdk/client-rds-data';

import { postgresSavedShops } from '../postgres-saved-shops.ts';
import { createRdsDataDatabase } from '../rds-data.ts';
import { createSavedShopHandler } from '../saved-shops.ts';

const connection = {
  database: 'fixture',
  resourceArn: 'arn:aws:rds:eu-west-2:000000000000:cluster:cheapo-fixture',
  secretArn: 'arn:aws:secretsmanager:eu-west-2:000000000000:secret:cheapo-fixture',
};

type Command = BeginTransactionCommand | CommitTransactionCommand | ExecuteStatementCommand | RollbackTransactionCommand;

function fixture(respond: (command: Command) => unknown) {
  const commands: Command[] = [];
  const delays: number[] = [];
  const client = {
    send: async (command: Command) => {
      commands.push(command);
      return respond(command);
    },
  } as Pick<RDSDataClient, 'send'>;
  const database = createRdsDataDatabase(connection, client, async (ms) => { delays.push(ms); });
  return { database, commands, delays };
}

test('runs the existing query shape with named parameters and lossless values', async () => {
  const { database, commands } = fixture(() => ({
    columnMetadata: [
      { label: 'pack', typeName: 'jsonb' },
      { label: 'price', typeName: 'numeric' },
      { label: 'revision', typeName: 'int8' },
      { label: 'position', typeName: 'int4' },
      { label: 'active', typeName: 'bool' },
      { name: 'address', typeName: 'text' },
    ],
    records: [[
      { stringValue: '{"unit":"litre","amount":1.5}' },
      { stringValue: '1200000000000000000.0310' },
      { stringValue: '9223372036854775807' },
      { stringValue: '12' },
      { booleanValue: false },
      { isNull: true },
    ]],
  }));

  const description = "O'Reilly";
  const results = await database.query(`
    SELECT $1::uuid, $2::jsonb, $1, $3, $4, $5, $6, 'leave $99 alone' -- $88
  `, ['shopper-id', { label: description }, null, description, 23.5, true]);
  assert.deepEqual(results.rows, [{
    pack: { unit: 'litre', amount: 1.5 },
    price: '1200000000000000000.0310',
    revision: '9223372036854775807',
    position: 12,
    active: false,
    address: null,
  }]);
  assert.equal(commands.length, 1);
  const command = commands[0];
  assert(command instanceof ExecuteStatementCommand);
  assert.match(command.input.sql!, /:p1::uuid, :p2::jsonb, :p1, :p3, :p4, :p5, :p6, 'leave \$99 alone' -- \$88/);
  assert.deepEqual(command.input.parameters, [
    { name: 'p1', value: { stringValue: 'shopper-id' } },
    { name: 'p2', value: { stringValue: JSON.stringify({ label: description }) }, typeHint: 'JSON' },
    { name: 'p3', value: { isNull: true } },
    { name: 'p4', value: { stringValue: description } },
    { name: 'p5', value: { doubleValue: 23.5 } },
    { name: 'p6', value: { booleanValue: true } },
  ]);
  assert.equal(command.input.transactionId, undefined);
  assert.deepEqual(command.input.resultSetOptions, { decimalReturnType: 'STRING', longReturnType: 'STRING' });
});

test('uses one transaction ID through ordered statements and commit', async () => {
  const { database, commands } = fixture(command => command instanceof BeginTransactionCommand
    ? { transactionId: 'test-transaction' } : {});
  const value = await database.transaction(async query => {
    await query('SELECT $1', [42]);
    await query('SELECT $1', ['check']);
    return 'saved';
  });
  assert.equal(value, 'saved');
  assert.deepEqual(commands.map(command => command.constructor.name), [
    'BeginTransactionCommand', 'ExecuteStatementCommand', 'ExecuteStatementCommand', 'CommitTransactionCommand',
  ]);
  for (const command of commands.slice(1)) {
    assert('transactionId' in command.input);
    assert.equal(command.input.transactionId, 'test-transaction');
  }
});

test('rolls back a failed write without replaying it or masking its error', async () => {
  const error = new Error('write outcome unavailable');
  const { database, commands } = fixture(command => {
    if (command instanceof BeginTransactionCommand) return { transactionId: 'test-transaction' };
    if (command instanceof ExecuteStatementCommand) throw error;
    throw new Error('rollback also unavailable');
  });
  await assert.rejects(database.transaction(query => query('DELETE FROM fixture', [])), err => err === error);
  assert.deepEqual(commands.map(command => command.constructor.name), [
    'BeginTransactionCommand', 'ExecuteStatementCommand', 'RollbackTransactionCommand',
  ]);
});

test('retries a paused writer only before the transaction starts', async () => {
  const warming = new DatabaseResumingException({ message: 'fixture is waking', $metadata: {} });
  let begins = 0;
  const { database, commands, delays } = fixture(command => {
    if (command instanceof BeginTransactionCommand) {
      if (++begins <= 2) throw warming;
      return { transactionId: 'test-transaction' };
    }
    if (command instanceof ExecuteStatementCommand) throw warming;
    return {};
  });

  await assert.rejects(database.transaction(query => query('SELECT $1', [1])), err => err === warming);
  assert.deepEqual(delays, [1_000, 3_000]);
  assert.deepEqual(commands.map(command => command.constructor.name), [
    'BeginTransactionCommand', 'BeginTransactionCommand', 'BeginTransactionCommand',
    'ExecuteStatementCommand', 'RollbackTransactionCommand',
  ]);
});

test('stops warming retries and preserves the service exception', async () => {
  const warming = new DatabaseResumingException({ message: 'fixture stays paused', $metadata: {} });
  const { database, commands, delays } = fixture(() => { throw warming; });
  await assert.rejects(database.query('SELECT 1', []), err => err === warming);
  assert.equal(commands.length, 5);
  assert.deepEqual(delays, [1_000, 3_000, 6_000, 8_000]);
});

test('fails closed on bad bind counts, unsafe numbers, or missing result metadata', async () => {
  const { database, commands } = fixture(() => ({ records: [[{ stringValue: 'unlabelled value' }]] }));
  await assert.rejects(database.query('SELECT $2', [1]), /bind count/);
  await assert.rejects(database.query('SELECT $1', [Number.MAX_SAFE_INTEGER + 1]), /exact number/);
  assert.equal(commands.length, 0);
  await assert.rejects(database.query('SELECT $1', [1]), /column metadata/);
});

test('serves the authenticated saved-shop route through the same transaction boundary', async () => {
  const householdId = '00000000-0000-4000-8000-000000000001';
  const shopperId = '00000000-0000-4000-8000-000000000002';
  const { database, commands } = fixture(command => {
    if (command instanceof BeginTransactionCommand) return { transactionId: 'test-transaction' };
    if (!(command instanceof ExecuteStatementCommand)) return {};
    const sql = command.input.sql ?? '';
    if (sql.includes('FROM cheapo.resolve_shopping_member')) {
      assert.deepEqual(command.input.parameters, [
        { name: 'p1', value: { stringValue: 'f631f9f66ea227a56a513a872b6b16872365191cafaa27dd47b7852562e65ef5' } },
        { name: 'p2', value: { booleanValue: false } },
      ]);
      return {
        columnMetadata: [
          { label: 'household_id', typeName: 'uuid' },
          { label: 'shopper_id', typeName: 'uuid' },
          { label: 'active', typeName: 'bool' },
        ],
        records: [[{ stringValue: householdId }, { stringValue: shopperId }, { booleanValue: true }]],
      };
    }
    assert(sql.includes('FROM cheapo.household_saved_shop'));
    assert.deepEqual(command.input.parameters?.map(param => param.value?.stringValue), [householdId, shopperId]);
    return {
      columnMetadata: [
        { label: 'id', typeName: 'text' },
        { label: 'name', typeName: 'text' },
        { label: 'address', typeName: 'text' },
        { label: 'location', typeName: 'jsonb' },
        { label: 'nickname', typeName: 'text' },
        { label: 'test_shop', typeName: 'bool' },
        { label: 'selected', typeName: 'bool' },
      ],
      records: [[
        { stringValue: 'fixture-branch' }, { stringValue: 'Sample shop' }, { isNull: true },
        { stringValue: '{"latitude":51.5,"longitude":-0.1}' }, { stringValue: 'Local' },
        { isNull: true }, { booleanValue: true },
      ]],
    };
  });
  const api = createSavedShopHandler(postgresSavedShops(database.transaction));
  const headers = { Authorization: `Bearer cheapo_${'A'.repeat(43)}` };
  const result = await api(new Request('http://localhost/v1/me/saved-shops', { headers }));
  assert.equal(result.status, 200);
  const shop = { id: 'fixture-branch', name: 'Sample shop', nickname: 'Local', location: { latitude: 51.5, longitude: -0.1 } };
  assert.deepEqual(await result.json(), { shops: [shop], currentShop: shop });
  assert(commands.at(-1) instanceof CommitTransactionCommand);
});
