import type { PackagePriceBasis } from '@cheapo/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createOwnerShoppingReads } from '@/data/cheapo-shopping-read-device';
import { cheapoShoppingReadCache } from '@/data/cheapo-shopping-read-cache';
import { comparisonPreferenceGroup, createEnrolledComparisonPreferences, type PreferenceValue } from '@/data/enrolled-comparison-preferences';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';

type Repository = ReturnType<typeof createEnrolledComparisonPreferences>;
type Snapshot = { repository: Repository; groupId: string; value?: PreferenceValue; error?: string };

export function useSavedPriceComparisonGroup(shopping: CheapoShoppingRuntime | null, productId?: string | null, productType?: string) {
  const [checked, setChecked] = useState<{ shopping: CheapoShoppingRuntime; id: string; group?: string }>();
  useEffect(() => {
    if (!shopping || !productId) return;
    const controller = new AbortController();
    const reads = createOwnerShoppingReads(shopping.owner);
    void reads.findProductById(productId, controller.signal).then(result => {
      if (!controller.signal.aborted && result.status !== 'unavailable') {
        setChecked({ shopping, id: productId, group: result.value.product?.comparableGroupId });
      }
    }).catch(() => {});
    const unsubscribe = cheapoShoppingReadCache.subscribeClear(() => {
      controller.abort();
      setChecked(previous => previous?.shopping === shopping && previous.id === productId ? undefined : previous);
    });
    return () => { controller.abort(); unsubscribe(); };
  }, [productId, shopping]);
  if (!shopping) return undefined;
  if (!productId) return comparisonPreferenceGroup(undefined, productType);
  if (checked?.id === productId && checked.shopping === shopping) return comparisonPreferenceGroup(checked.group, productType);
}

export function useComparisonPreference(shopping: CheapoShoppingRuntime | null, groupId?: string) {
  const repository = useMemo(() => {
    if (!shopping) return undefined;
    const reads = createOwnerShoppingReads(shopping.owner);
    return createEnrolledComparisonPreferences({
      queue: shopping.mutationQueue,
      readHosted: reads.loadComparisonPreference,
      assertOwner: shopping.assertOwner,
      sync: shopping.retry,
    });
  }, [shopping]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [saving, setSaving] = useState(false);
  const scope = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const current = snapshot?.repository === repository && snapshot?.groupId === groupId ? snapshot : undefined;

  useEffect(() => {
    if (!shopping || !repository || !groupId) return;
    const controller = new AbortController();
    scope.current = controller;
    let read: AbortController | undefined;
    function refresh(localOnly = false) {
      if (controller.signal.aborted || !repository || !groupId) return;
      read?.abort();
      read = new AbortController();
      const attempt = ++generation.current;
      const result = localOnly ? repository.loadLocal(groupId) : repository.load(groupId, read.signal);
      void result.then(value => {
        if (!controller.signal.aborted && attempt === generation.current) setSnapshot({ repository, groupId, value });
      }).catch(() => {
        if (!controller.signal.aborted && attempt === generation.current) {
          setSnapshot({ repository, groupId, error: 'Comparison preference unavailable.' });
        }
      });
    }
    refresh();
    const unsubscribeSync = shopping.subscribeSync(() => refresh());
    const unsubscribeClear = cheapoShoppingReadCache.subscribeClear(() => {
      setSnapshot(undefined);
      refresh(true);
    });
    return () => { controller.abort(); read?.abort(); scope.current = null; unsubscribeSync(); unsubscribeClear(); };
  }, [groupId, repository, shopping]);

  const choose = useCallback(async (basis: PackagePriceBasis | null) => {
    const controller = scope.current;
    if (!controller || !repository || !groupId || !current?.value?.base || saving) return;
    const attempt = ++generation.current;
    setSaving(true);
    try {
      const value = await repository.save(current.value, basis);
      if (controller.signal.aborted) return;
      if (attempt === generation.current) setSnapshot({ repository, groupId, value });
      else {
        const localAttempt = ++generation.current;
        const local = await repository.loadLocal(groupId);
        if (!controller.signal.aborted && localAttempt === generation.current) setSnapshot({ repository, groupId, value: local });
      }
    } catch {
      if (!controller.signal.aborted && attempt === generation.current) {
        setSnapshot({ ...current, error: 'Could not save your comparison preference. Try again.' });
      }
    } finally {
      setSaving(false);
    }
  }, [current, groupId, repository, saving]);

  if (!repository || !groupId) return undefined;
  return { basis: current?.value?.basis ?? null, checked: Boolean(current?.value?.base),
    loading: !current, error: current?.error, saving,
    lastSyncedAt: current?.value?.lastSyncedAt, choose };
}
