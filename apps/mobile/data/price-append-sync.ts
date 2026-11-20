import { CheapoAccessError, type CheapoAccess } from '../lib/cheapo-access/client';
import type { PriceAppendQueue } from './price-append-queue';

type OpenSession = CheapoAccess['openPriceAppendSession'];
type SyncResult = 'complete' | 'blocked' | 'failed';
const appendDeadlineMs = 45_000;

async function sendAppend(post: Awaited<ReturnType<OpenSession>>['post'], body: string) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Error('Cheapo did not acknowledge this price in time.'));
    }, appendDeadlineMs);
  });
  const request = async () => {
    const response = await post(body, controller.signal);
    const { status } = response;
    const receipt: unknown = status === 200 || status === 201 ? await response.json() : undefined;
    return { status, receipt };
  };
  try {
    return await Promise.race([request(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createPriceAppendSync(queue: PriceAppendQueue, openSession: OpenSession) {
  async function synchronize(): Promise<SyncResult> {
    const { entries, recovery } = await queue.read();
    const pending = entries.filter(entry => !entry.receipt);
    if (!pending.length) return recovery.length ? 'failed' : 'complete';

    const { owner, post } = await openSession();
    if (owner.origin !== queue.owner.origin || owner.householdId !== queue.owner.householdId
      || owner.shopperId !== queue.owner.shopperId) return 'blocked';

    let failed = false;
    for (const entry of pending) {
      try {
        const { status, receipt } = await sendAppend(post, entry.body);
        if (status === 401 || status === 403) return 'blocked';
        if (!receipt) {
          failed = true;
          continue;
        }
        await queue.acknowledge(entry.record.id, receipt);
      } catch (error) {
        if (error instanceof CheapoAccessError) return 'blocked';
        // A lost reply or interrupted acknowledgement leaves the original intent.
        failed = true;
      }
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
