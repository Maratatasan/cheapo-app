import { setTimeout as sleep } from 'node:timers/promises';
import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  DatabaseResumingException,
  ExecuteStatementCommand,
  type ExecuteStatementCommandOutput,
  type Field,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';

type Connection = { database: string; resourceArn: string; secretArn: string };
type Query = <Row extends object>(text: string, params: unknown[]) => Promise<{ rows: Row[] }>;

const requestBudgetMs = 25_000;
const rollbackBudgetMs = 2_000;
const resumeDelays = [1_000, 3_000, 6_000, 8_000];

// The routes supply application-owned SQL. Leave placeholders inside quoted values,
// identifiers, dollar-quoted text, and comments untouched.
const sqlTokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|(\$(?:[a-z_]\w*)?\$)[\s\S]*?\1|\$([1-9]\d*)/gi;

function bindParameter(name: string, value: unknown): SqlParameter {
  if (value === null) return { name, value: { isNull: true } };
  if (typeof value === 'string') return { name, value: { stringValue: value } };
  if (typeof value === 'boolean') return { name, value: { booleanValue: value } };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error('Pass an exact number or bind decimal text with an explicit SQL cast.');
    }
    const field = Number.isInteger(value) ? { longValue: value } : { doubleValue: value };
    return { name, value: field };
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return { name, typeHint: 'JSON', value: { stringValue: JSON.stringify(value) } };
  }
  throw new Error('Unsupported Data API parameter value.');
}

function bindStatement(text: string, values: unknown[]) {
  const binds = new Set<number>();
  const sql = text.replace(sqlTokens, (token: string, _dollarQuote?: string, position?: string) => {
    if (!position) return token;
    binds.add(Number(position));
    return ':p' + position;
  });
  if (binds.size !== values.length || values.some((_, index) => !binds.has(index + 1))) {
    throw new Error('Unexpected SQL bind count.');
  }
  return { sql, parameters: values.map((value, index) => bindParameter('p' + (index + 1), value)) };
}

function decodeField(field: Field, type: string) {
  if (field.isNull) return null;
  if (field.stringValue !== undefined) {
    if (type === 'json' || type === 'jsonb') return JSON.parse(field.stringValue) as unknown;
    // PostgreSQL's small integer types fit in JS numbers. Keep bigints and decimals as text.
    if (type === 'int2' || type === 'int4') return Number(field.stringValue);
    return field.stringValue;
  }
  const exactNumeric = type === 'numeric' || type === 'decimal' || type === 'int8' || type === 'bigint';
  if (field.booleanValue !== undefined) return field.booleanValue;
  if (field.doubleValue !== undefined && !exactNumeric) return field.doubleValue;
  if (field.longValue !== undefined && Number.isSafeInteger(field.longValue)) {
    return exactNumeric ? String(field.longValue) : field.longValue;
  }
  throw new Error('Unsupported Data API result field.');
}

function decodeRows<Row extends object>({ records, columnMetadata }: ExecuteStatementCommandOutput): Row[] {
  if (!records?.length) return [];
  if (!columnMetadata?.length) throw new Error('Missing Data API column metadata.');
  const columns = columnMetadata.map(column => {
    const name = column.label || column.name;
    if (!name || !column.typeName) throw new Error('Invalid Data API column metadata.');
    return { name, type: column.typeName.toLowerCase() };
  });
  return records.map(row => {
    if (row.length !== columns.length) throw new Error('Data API row does not match its column metadata.');
    return Object.fromEntries(columns.map(({ name, type }, index) => [name, decodeField(row[index], type)])) as Row;
  });
}

export function createRdsDataDatabase(
  { database, ...scope }: Connection,
  client: Pick<RDSDataClient, 'send'> = new RDSDataClient({ maxAttempts: 1 }),
  wait = (ms: number, signal: AbortSignal) => sleep(ms, undefined, { signal }),
) {
  // The service explicitly cancels a paused database request before execution.
  // Ambiguous transport errors and operations in an open transaction are never replayed.
  async function duringResume<T>(send: () => Promise<T>, signal: AbortSignal): Promise<T> {
    for (const delay of resumeDelays) {
      try {
        return await send();
      } catch (error) {
        if (!(error instanceof DatabaseResumingException)) throw error;
      }
      await wait(delay, signal);
    }
    return send();
  }

  function queryWithSignal(signal: AbortSignal, transactionId?: string): Query {
    return async <Row extends object>(text: string, values: unknown[]) => {
      const command = new ExecuteStatementCommand({
        ...scope,
        database,
        transactionId,
        ...bindStatement(text, values),
        includeResultMetadata: true,
        resultSetOptions: { decimalReturnType: 'STRING', longReturnType: 'STRING' },
      });
      const execute = () => client.send(command, { abortSignal: signal });
      const result = transactionId ? await execute() : await duringResume(execute, signal);
      return { rows: decodeRows<Row>(result) };
    };
  }

  return {
    query<Row extends object>(text: string, values: unknown[]) {
      return queryWithSignal(AbortSignal.timeout(requestBudgetMs))<Row>(text, values);
    },
    async transaction<T>(run: (query: Query) => Promise<T>): Promise<T> {
      const signal = AbortSignal.timeout(requestBudgetMs);
      const { transactionId } = await duringResume(
        () => client.send(new BeginTransactionCommand({ ...scope, database }), { abortSignal: signal }),
        signal,
      );
      if (!transactionId) throw new Error('Data API did not return a transaction ID.');

      const transaction = { ...scope, transactionId };
      try {
        const result = await run(queryWithSignal(signal, transactionId));
        await client.send(new CommitTransactionCommand(transaction), { abortSignal: signal });
        return result;
      } catch (error) {
        await client.send(new RollbackTransactionCommand(transaction), {
          abortSignal: AbortSignal.timeout(rollbackBudgetMs),
        }).catch(() => {});
        throw error;
      }
    },
  };
}
