import { packagePriceBases, type PackagePriceBasis } from '@cheapo/domain';
import { randomUUID } from 'expo-crypto';

import type { ComparisonPreferenceRead, ShoppingRead } from './cheapo-shopping-reads';
import { matchComparisonName } from './comparison-prices';
import type { ShoppingMutationQueue } from './shopping-mutation-queue';
import type { ShoppingMutation } from './shopping-mutations';

type PreferenceAction = Extract<ShoppingMutation['action'], { kind: 'preference' }>;
type PreferenceBase = PreferenceAction['base'];
export type PreferenceValue = {
  groupId: string;
  basis: PackagePriceBasis | null;
  base?: PreferenceBase;
  sync: 'fresh' | 'cached' | 'unavailable';
  lastSyncedAt?: string;
};

type Dependencies = {
  queue: Pick<ShoppingMutationQueue, 'read' | 'enqueue'>;
  readHosted: (groupId: string, signal?: AbortSignal) => Promise<ShoppingRead<ComparisonPreferenceRead>>;
  assertOwner: () => Promise<void>;
  sync: () => Promise<unknown>;
};

export function comparisonPreferenceGroup(groupId?: string, productType?: string) {
  if (groupId && groupId !== '.' && groupId !== '..' && !/[\s\p{Cc}/]/u.test(groupId)) {
    const key = /^(?:type|group):/.test(groupId) ? `group:${groupId}` : groupId;
    if (key.length <= 128) return key;
  }
  const type = matchComparisonName(productType)?.replaceAll('%', '%25').replaceAll('/', '%2F');
  const fallback = type && `type:${type}`;
  return fallback && fallback.length <= 128 && !/\p{Cc}/u.test(fallback) ? fallback : undefined;
}

export function createEnrolledComparisonPreferences(dependencies: Dependencies) {
  let pending: Promise<unknown> = Promise.resolve();

  async function project(groupId: string, hosted: ShoppingRead<ComparisonPreferenceRead>): Promise<PreferenceValue> {
    const { entries } = await dependencies.queue.read();
    await dependencies.assertOwner();
    const current: PreferenceValue = hosted.status === 'unavailable'
      ? { groupId, basis: null, sync: hosted.status }
      : { groupId, basis: hosted.value.basis, base: { kind: 'version', version: hosted.value.version },
        sync: hosted.status, lastSyncedAt: hosted.lastSyncedAt };
    for (const entry of entries) {
      const { action, operationId } = entry.intent;
      if (action.kind !== 'preference' || action.groupId !== groupId || entry.superseded) continue;
      const { outcome, resolution } = entry;
      if (resolution) {
        if (resolution.kind !== 'keep-cloud' || outcome?.kind !== 'conflict' || typeof outcome.currentVersion !== 'number') continue;
        const raw = outcome.current && typeof outcome.current === 'object' && 'basis' in outcome.current
          ? outcome.current.basis : undefined;
        const basis = raw === null ? null : packagePriceBases.find(choice => choice === raw);
        if (basis === undefined || (current.base?.kind === 'version' && current.base.version >= outcome.currentVersion)) continue;
        current.basis = basis;
        current.base = { kind: 'version', version: outcome.currentVersion };
        continue;
      }
      if (outcome?.kind === 'applied') {
        const version = outcome.receipt.version;
        if (typeof version !== 'number' || (current.base?.kind === 'version' && current.base.version >= version)) continue;
        current.base = { kind: 'version', version };
      } else current.base = { kind: 'operation', operationId };
      current.basis = action.basis;
    }
    return current;
  }

  function save(value: PreferenceValue, basis: PackagePriceBasis | null): Promise<PreferenceValue> {
    const write = pending.then(async () => {
      await dependencies.assertOwner();
      if (!value.base) throw Error('Check your comparison preference before changing it.');
      if (value.basis === basis) return value;
      const { entries } = await dependencies.queue.read();
      const operationId = randomUUID();
      const previous = entries.at(-1)?.intent.createdAt;
      const createdAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
      await dependencies.assertOwner();
      await dependencies.queue.enqueue({
        operationId, createdAt, title: 'Comparison preference',
        action: { kind: 'preference', groupId: value.groupId, basis, base: value.base },
        waitFor: value.base.kind === 'operation' ? [value.base.operationId] : [],
      });
      await dependencies.assertOwner();
      void dependencies.sync().catch(() => {});
      return { ...value, basis, base: { kind: 'operation', operationId } as const };
    });
    pending = write.catch(() => {});
    return write;
  }

  return {
    async load(groupId: string, signal?: AbortSignal) {
      await dependencies.assertOwner();
      return project(groupId, await dependencies.readHosted(groupId, signal));
    },
    async loadLocal(groupId: string) {
      await dependencies.assertOwner();
      return project(groupId, { status: 'unavailable' });
    },
    save,
  };
}
