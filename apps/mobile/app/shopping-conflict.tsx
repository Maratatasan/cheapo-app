import { useCallback, useRef, useState } from 'react';
import { Redirect, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { DisplayState } from '@/component/results/display-state';
import { ui } from '@/component/results/theme';
import { ShoppingConflictReview } from '@/component/shopping-conflict';
import { createOwnerShoppingReads } from '@/data/cheapo-shopping-read-device';
import { shoppingConflictPreview, type ShoppingConflict } from '@/data/shopping-conflict';
import { mutationOperationId } from '@/data/shopping-mutations';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';

export default function ShoppingConflictRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const shopping = useCheapoShopping();
  if (!shopping || !id || Platform.OS === 'web' || !mutationOperationId.safeParse(id).success) return <Redirect href="/pending-sync" />;
  const { origin, householdId, shopperId } = shopping.owner;
  return <ConflictRoute key={JSON.stringify([origin, householdId, shopperId, id])} shopping={shopping} operationId={id} />;
}

function ConflictRoute({ shopping, operationId }: { shopping: CheapoShoppingRuntime; operationId: string }) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const [preview, setPreview] = useState<ShoppingConflict | null>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  const committing = useRef(false);
  const phoneReplacement = useRef<{ replacementId: string; createdAt: string } | undefined>(undefined);
  const close = () => router.dismissTo('/pending-sync');

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      await shopping.assertOwner();
      const queue = shopping.mutationQueue;
      const [{ entries, recovery }, later] = await Promise.all([queue.read(), queue.laterEdits(operationId)]);
      await shopping.assertOwner();
      if (signal.aborted) return;
      const entry = entries.find(candidate => candidate.intent.operationId === operationId);
      setPreview(entry && !recovery.some(item => item.operationId === operationId && item.reason === 'unreadable')
        ? shoppingConflictPreview(entry, later) : null);
    } catch {
      if (!signal.aborted) setPreview(null);
    }
  }, [operationId, shopping]);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    active.current = controller;
    void load(controller.signal);
    return () => { controller.abort(); active.current = null; };
  }, [load]));

  async function choose(commit: (signal: AbortSignal) => Promise<void>, failure: string) {
    const signal = active.current?.signal;
    if (!signal || !preview || committing.current) return;
    committing.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await commit(signal);
      void shopping.retry().catch(() => { /* The chosen version and pending edits are still protected. */ });
      if (!signal.aborted) close();
    } catch {
      if (!signal.aborted) {
        setError(failure);
        await load(signal);
      }
    } finally {
      committing.current = false;
      if (!signal.aborted) setSaving(false);
    }
  }

  function keep(choice: Parameters<CheapoShoppingRuntime['resolveConflict']>[1]) {
    return choose(() => shopping.resolveConflict(operationId, choice), 'Could not keep this version. Review any later edits and try again.');
  }

  function reuseProduct() {
    const match = preview?.matchingProduct;
    if (!match) return;
    return choose(async signal => {
      const reads = createOwnerShoppingReads(shopping.owner);
      const checked = await reads.findEditableProductByBarcode(match.barcode, signal);
      if (signal.aborted) throw Error('The product review closed.');
      if (checked.status !== 'fresh' || checked.value.product?.id !== match.id) throw Error('The current barcode match could not be verified.');
      await shopping.useExistingProduct(operationId, match.id);
    }, 'Could not verify the barcode match. Your saved price and photos are still here. Try again.');
  }

  return <>
    <Stack.Screen options={{ title: preview?.matchingProduct ? 'Review product match' : 'Review conflict' }} />
    {preview ? <ShoppingConflictReview conflict={preview} busy={saving} error={error} bottomInset={bottom}
      onKeepPhone={() => {
        const replacement = phoneReplacement.current ??= { replacementId: randomUUID(), createdAt: new Date().toISOString() };
        void keep({ kind: 'keep-phone', ...replacement });
      }}
      onKeepCloud={laterIds => { void keep({ kind: 'keep-cloud', laterIds }); }}
      onReuseProduct={() => { void reuseProduct(); }} onClose={close} />
      : <View style={ui.content}>
        {preview === undefined ? <DisplayState kind="loading" title="Reading the conflict" description="Loading both saved versions." />
          : <DisplayState kind="empty" title="Conflict unavailable" description="Return to Pending sync to check this record."
            actionLabel="Back to Pending sync" onAction={close} />}
      </View>}
  </>;
}
