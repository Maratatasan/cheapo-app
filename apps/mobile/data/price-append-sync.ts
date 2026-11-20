import { CheapoAccessError, type CheapoAccess } from '../lib/cheapo-access/client';
import { sameShoppingOwner, type PriceAppendQueue } from './price-append-queue';
import { readShoppingWriteReply } from './shopping-write-reply';

type OpenSession = CheapoAccess['openShoppingWriteSession'];
type SyncResult = 'complete' | 'blocked' | 'failed';
const appendPath = '/v1/me/price-observations';

export function createPriceAppendSync(
  queue: PriceAppendQueue, openSession: OpenSession, canSend: (body: string) => boolean = () => true,
) {
  async function synchronize(): Promise<SyncResult> {
    const { entries, recovery } = await queue.read();
    const pending = entries.flatMap(({ record, body, receipt }) => body && !receipt && canSend(body) ? [{ sourceId: record.id, body }] : []);
    if (!pending.length) return recovery.length ? 'failed' : 'complete';

    const { owner, request, assertCurrent } = await openSession();
    if (!sameShoppingOwner(owner, queue.owner)) return 'blocked';

    let failed = false;
    for (const entry of pending) {
      try {
        const { status, body: receipt } = await readShoppingWriteReply(request, appendPath, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: entry.body,
        }, status => status === 200 || status === 201);
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
