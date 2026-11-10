import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendResponseDebug } from './response-debug.mjs';

test('appends two raw responses, filters credential headers and keeps the file owner-only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'route1-response-debug-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'response-debug.jsonl');
  const first = new Response('{"error":{"message":"raw provider detail"}}', { status: 400, headers: {
    'content-type': 'application/json', 'x-request-id': 'req_test123', authorization: 'Bearer header-secret', cookie: 'session=cookie-secret', 'set-cookie': 'token=set-cookie-secret', 'x-session-token': 'also-secret', 'x-codex-turn-state': 'provider-session-secret', 'x-future-session': 'unknown-secret'
  } });
  const second = new Response('data: {"type":"response.completed"}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  await appendResponseDebug(path, first, '2026-11-09T12:00:00.000Z');
  await appendResponseDebug(path, second, '2026-11-09T12:00:01.000Z');

  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(line => [line.timestamp, line.status, line.bodyText]), [
    ['2026-11-09T12:00:00.000Z', 400, '{"error":{"message":"raw provider detail"}}'],
    ['2026-11-09T12:00:01.000Z', 200, 'data: {"type":"response.completed"}\n\n']
  ]);
  assert.equal(lines[0].headers['content-type'], 'application/json');
  assert.equal(lines[0].headers['x-request-id'], 'req_test123');
  const log = await readFile(path, 'utf8');
  for (const secret of ['Bearer header-secret', 'cookie-secret', 'set-cookie-secret', 'also-secret', 'provider-session-secret', 'unknown-secret', 'request-token', 'data:image/']) assert.equal(log.includes(secret), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('caps each body and marks truncation with observed byte count', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'route1-response-debug-cap-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const record = await appendResponseDebug(join(directory, 'response-debug.jsonl'), new Response('x'.repeat(1_000_100)), '2026-11-09T12:00:00.000Z');
  assert.equal(record.bytesCaptured, 1_000_000);
  assert.equal(record.bytesObserved, 1_000_100);
  assert.equal(record.bodyText.length, 1_000_000);
  assert.equal(record.bodyTruncated, true);
  assert.equal(record.debugLogSaved, true);
});
