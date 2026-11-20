import { CheapoAccessError, type CheapoAccess } from '../lib/cheapo-access/client';
import { describePriceEvidence, transferPricePhoto, type PricePhotoIntent } from './cheapo-price-photo-transfer';
import type { LocalPhotoDraft } from './local-photo';
import type { PriceAppendQueue, PriceAppendReceipt } from './price-append-queue';

type OpenSession = CheapoAccess['openShoppingWriteSession'];

type EvidenceWork = { record: LocalPhotoDraft; receipt: PriceAppendReceipt; intent: PricePhotoIntent };

export function createPriceEvidenceSync(
  queue: PriceAppendQueue,
  openSession: OpenSession,
  describe = describePriceEvidence,
  transfer = transferPricePhoto,
) {
  return async (signal?: AbortSignal): Promise<'complete' | 'blocked' | 'failed'> => {
    try {
      if (signal?.aborted) return 'failed';
      const { entries } = await queue.read();
      const pending: EvidenceWork[] = [];
      let failed = false;
      for (const { record, receipt } of entries) {
        if (!record.original || !receipt) continue;
        const source = { record, receipt };
        try {
          let intents = await queue.evidence.load(source);
          if (!intents) {
            const planned = await describe(record, receipt, signal);
            await queue.evidence.save(source, planned);
            intents = await queue.evidence.load(source);
          }
          for (const intent of intents ?? []) pending.push({ ...source, intent });
        } catch {
          failed = true;
          await queue.markFailed(record.id, 'photo').catch(() => {});
        }
      }
      if (!pending.length) return failed ? 'failed' : 'complete';
      if (signal?.aborted) return 'failed';
      const session = await openSession();
      const { owner } = session;
      if (owner.origin !== queue.owner.origin || owner.householdId !== queue.owner.householdId
        || owner.shopperId !== queue.owner.shopperId) return 'blocked';

      for (const { intent, ...source } of pending) {
        if (signal?.aborted) return 'failed';
        try {
          const result = await transfer(intent, session, signal);
          session.assertCurrent();
          if (result === 'blocked') return 'blocked';
          if (result === 'available') {
            await queue.evidence.acknowledge(source, intent);
            continue;
          }
        } catch (error) {
          if (error instanceof CheapoAccessError) return 'blocked';
        }
        failed = true;
        await queue.markFailed(source.record.id, 'photo').catch(() => {});
      }
      return failed ? 'failed' : 'complete';
    } catch (error) {
      return error instanceof CheapoAccessError ? 'blocked' : 'failed';
    }
  };
}
