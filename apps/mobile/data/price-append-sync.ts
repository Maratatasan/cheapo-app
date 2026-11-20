import { CheapoAccessError, type CheapoAccess } from '../lib/cheapo-access/client';
import type { PriceAppendQueue } from './price-append-queue';

type OpenSession = CheapoAccess['openShoppingWriteSession'];
type SyncResult = 'complete' | 'blocked' | 'failed';
const appendDeadlineMs = 45_000;
const appendPath = '/v1/me/price-observations';

async function sendAppend(request: Awaited<ReturnType<OpenSession>>['request'], body: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Error('Cheapo did not acknowledge this price in time.'));
    }, appendDeadlineMs);
  });
  const attempt = async () => {
    const response = await request(appendPath, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal,
    });
    const { status } = response;
    const receipt: unknown = status === 200 || status === 201 ? await response.json() : undefined;
    return { status, receipt };
  };
  try {
    return await Promise.race([attempt(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createPriceAppendSync(queue: PriceAppendQueue, openSession: OpenSession) {
  async function synchronize(): Promise<SyncResult> {
    const { entries, recovery } = await queue.read();
    const pending = entries.flatMap(({ record, body, receipt }) => body && !receipt ? [{ sourceId: record.id, body }] : []);
    if (!pending.length) return recovery.length ? 'failed' : 'complete';

    const { owner, request, assertCurrent } = await openSession();
    if (owner.origin !== queue.owner.origin || owner.householdId !== queue.owner.householdId
      || owner.shopperId !== queue.owner.shopperId) return 'blocked';

    let failed = false;
    for (const entry of pending) {
      try {
        const { status, receipt } = await sendAppend(request, entry.body);
        assertCurrent();
        if (status === 401 || status === 403) return 'blocked';
        if (receipt) {
          await queue.acknowledge(entry.sourceId, receipt);
          continue;
        }
      } catch (error) {
        if (error instanceof CheapoAccessError) return 'blocked';
      }
      // A lost reply or interrupted acknowledgement leaves the original intent.
      failed = true;
      await queue.markFailed(entry.sourceId, 'price').catch(() => {});
    }
    if (failed || (recovery.length && (await queue.read()).recovery.length)) return 'failed';
    return 'complete';
  }

  let active: Promise<SyncResult> | undefined;
  let requested = false;
  return function sync() {
    requested = true;
    if (!active) {
      active = Promise.resolve().then(async () => {
        try {
          let result: SyncResult = 'complete';
          while (requested) {
            requested = false;
            try {
              result = await synchronize();
            } catch (error) {
              result = error instanceof CheapoAccessError ? 'blocked' : 'failed';
            }
          }
          return result;
        } finally {
          active = undefined;
        }
      });
    }
    return active;
  };
}
