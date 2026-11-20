import { CheapoAccessError, type CheapoAccess } from '../lib/cheapo-access/client';
import type { PriceAppendQueue, PriceAppendReceipt } from './price-append-queue';

type OpenSession = CheapoAccess['openPriceAppendSession'];
type SyncResult = 'complete' | 'blocked' | 'failed';

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
        const response = await post(entry.body);
        if (response.status === 401 || response.status === 403) return 'blocked';
        if (response.status !== 200 && response.status !== 201) {
          failed = true;
          continue;
        }
        const receipt: PriceAppendReceipt = await response.json();
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
