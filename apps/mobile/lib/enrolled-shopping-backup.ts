import { openPriceAppendQueue, priceQueueRoot, type PriceQueueOwner } from '@/data/price-append-queue';
import { openShoppingMutationQueue, shoppingMutationRoot, type QueuedShoppingMutation } from '@/data/shopping-mutation-queue';
import { cheapoAccess } from '@/lib/cheapo-access/device';

export class EnrolledBackupError extends Error {}

function sameOwner(first: PriceQueueOwner, second: PriceQueueOwner | null) {
  return second?.origin === first.origin && second.householdId === first.householdId && second.shopperId === first.shopperId;
}

function validateQueueReferences(entries: QueuedShoppingMutation[], operationIds: Set<string>, priceIds: Set<string>) {
  for (const entry of entries) {
    const { action, waitFor } = entry.intent;
    const base = 'base' in action ? action.base : undefined;
    const required = [...waitFor];
    if (base?.kind === 'operation') required.push(base.operationId);
    if (entry.resolves) required.push(entry.resolves);
    if (entry.resolution?.kind === 'keep-phone') required.push(entry.resolution.replacementId);
    if (entry.resolution?.kind === 'keep-cloud') required.push(...entry.resolution.laterIds);
    if (required.some(operationId => !operationIds.has(operationId)) ||
      (base?.kind === 'append' && !priceIds.has(base.sourceId))) {
      throw new EnrolledBackupError('A queued shopping edit refers to work missing from this backup. The complete backup could not be prepared.');
    }
  }
}

export async function loadEnrolledShoppingBackup(expectedOwner?: PriceQueueOwner) {
  const owner = await cheapoAccess?.lastVerifiedOwner();
  if (expectedOwner && !sameOwner(expectedOwner, owner ?? null)) {
    throw new EnrolledBackupError('Cheapo access changed during export. Start the export again.');
  }
  if (!owner) {
    if (priceQueueRoot().exists || shoppingMutationRoot().exists) {
      throw new EnrolledBackupError('Restore the Cheapo access used for pending shopping work before exporting it.');
    }
    return null;
  }

  const mutations = await openShoppingMutationQueue(owner);
  const prices = await openPriceAppendQueue(owner);
  // Freeze mutations first, matching the order in which a correction reads
  // its append receipt. Both snapshots describe the same from-device state.
  const { priceBackup, mutationFiles, mutationRecovery, records } = await mutations.backup(async mutationBackup => {
    const priceBackup = await prices.backup();
    const queued = priceBackup.entries.map(entry => entry.record);
    const records = [...new Map([...priceBackup.productPriceDrafts.map(draft => draft.record), ...queued]
      .map(record => [record.id, record])).values()];
    const readableIds = new Set(records.map(record => record.id));
    if (priceBackup.recovery.some(entry => entry.reason === 'unreadable' && !readableIds.has(entry.sourceId))) {
      throw new EnrolledBackupError('An enrolled price or its evidence could not be read. The complete backup could not be prepared.');
    }
    const operationIds = new Set(mutationBackup.files.filter(file => file.name.endsWith('.intent.json'))
      .map(file => file.name.slice(0, -'.intent.json'.length)));
    validateQueueReferences(mutationBackup.entries, operationIds, new Set(queued.map(record => record.id)));
    return { priceBackup, mutationFiles: mutationBackup.files, mutationRecovery: mutationBackup.recovery, records };
  });

  return {
    owner, records,
    priceRecovery: priceBackup.recovery, mutationRecovery,
    files: [
      ...priceBackup.files.map(({ name, bytes }) => ({ path: `recovery/prices/${name}`, bytes })),
      ...mutationFiles.map(({ name, bytes }) => ({ path: `recovery/mutations/${name}`, bytes })),
    ],
    async assertCurrentOwner() {
      if (!sameOwner(owner, await cheapoAccess?.lastVerifiedOwner() ?? null)) {
        throw new EnrolledBackupError('Cheapo access changed during export. Start the export again.');
      }
    },
  };
}

export type EnrolledShoppingBackup = NonNullable<Awaited<ReturnType<typeof loadEnrolledShoppingBackup>>>;
