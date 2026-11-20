import { useCallback, useRef, useState } from 'react';
import { Redirect, Stack, useFocusEffect, usePreventRemove, useRouter } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Shop } from '@cheapo/domain';
import { shopDisplayName } from '@cheapo/domain/names';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { PendingSync } from '@/component/pending-sync';
import { ui } from '@/component/results/theme';
import { ShopLoadFeedback } from '@/component/shop/shop-chooser';
import { ShopPicker } from '@/component/shop/shop-picker';
import type { CheapoShoppingRuntime, PendingShoppingChange } from '@/data/shopping-sync-runtime';
import { useSavedShops } from '@/hooks/use-saved-shops';

export default function PendingSyncRoute() {
  const shopping = useCheapoShopping();
  if (!shopping || Platform.OS === 'web') return <Redirect href="/" />;

  const { origin, householdId, shopperId } = shopping.owner;
  return <PendingShopping key={JSON.stringify([origin, householdId, shopperId])} shopping={shopping} />;
}

function PendingShopping({ shopping }: { shopping: CheapoShoppingRuntime }) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const [items, setItems] = useState<PendingShoppingChange[]>();
  const [unavailable, setUnavailable] = useState(false);
  const [syncProblem, setSyncProblem] = useState<'access' | 'service'>();
  const [retrying, setRetrying] = useState(false);
  const [chooseFor, setChooseFor] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [shopError, setShopError] = useState(false);
  const active = useRef<AbortController | null>(null);
  const readRevision = useRef(0);
  const processing = useRef(false);
  usePreventRemove(confirming);

  const refresh = useCallback(async (signal: AbortSignal) => {
    const revision = ++readRevision.current;
    try {
      const pending = await shopping.readPending();
      if (!signal.aborted && revision === readRevision.current) {
        setItems(pending);
        setUnavailable(false);
      }
    } catch {
      if (!signal.aborted && revision === readRevision.current) setUnavailable(true);
    }
  }, [shopping]);

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    active.current = controller;
    const unsubscribe = shopping.subscribeSync(result => {
      if (!controller.signal.aborted) {
        readRevision.current += 1;
        setItems(result.items);
        setUnavailable(false);
        setSyncProblem(result.state === 'blocked' ? 'access' : undefined);
      }
    });
    void refresh(controller.signal);
    return () => {
      controller.abort();
      unsubscribe();
      active.current = null;
      setRetrying(false);
    };
  }, [refresh, shopping]));

  async function retry() {
    const signal = active.current?.signal;
    if (!signal || processing.current) return;
    processing.current = true;
    setRetrying(true);
    try {
      const result = await shopping.retry();
      if (!signal.aborted) {
        setItems(result.items);
        setUnavailable(false);
        setSyncProblem(result.state === 'blocked' ? 'access' : undefined);
      }
    } catch {
      if (!signal.aborted) setSyncProblem('service');
    } finally {
      processing.current = false;
      if (!signal.aborted) setRetrying(false);
    }
  }

  async function confirm(shop: Shop) {
    const signal = active.current?.signal;
    const displayName = shopDisplayName(shop);
    if (!signal || !chooseFor || !displayName || processing.current) return;
    processing.current = true;
    setConfirming(true);
    setShopError(false);
    try {
      await shopping.confirmPriceShop(chooseFor, { id: shop.id, displayName });
      if (!signal.aborted) {
        setChooseFor(undefined);
        await refresh(signal);
      }
      void shopping.retry().catch(() => { if (!signal.aborted) setSyncProblem('service'); });
    } catch {
      if (!signal.aborted) setShopError(true);
    } finally {
      processing.current = false;
      if (!signal.aborted) setConfirming(false);
    }
  }

  return <>
    <Stack.Screen options={{ title: 'Pending sync' }} />
    {chooseFor ? <ChoosePriceShop busy={confirming} failed={shopError} onSelect={confirm}
      onCancel={() => { setChooseFor(undefined); setShopError(false); }} />
      : <PendingSync snapshot={unavailable ? { state: 'unavailable' } : items ? { state: 'ready', items } : { state: 'loading' }}
        retrying={retrying} syncProblem={syncProblem} onRetry={retry}
        onReload={() => { if (active.current) void refresh(active.current.signal); }}
        onChooseShop={id => {
          const item = items?.find(change => change.id === id);
          if (item?.state === 'needs-shop') setChooseFor(item.sourceId);
        }}
        onReviewConflict={id => {
          const item = items?.find(change => change.id === id);
          if (item?.state === 'conflict') router.push({ pathname: '/shopping-conflict', params: { id: item.operationId } });
        }}
        onBack={() => router.dismissTo('/')} bottomInset={bottom} />}
  </>;
}

function ChoosePriceShop({ busy, failed, onSelect, onCancel }: {
  busy: boolean; failed: boolean; onSelect(shop: Shop): void; onCancel(): void;
}) {
  const { shops, readError, retry } = useSavedShops();
  return <View style={ui.page}>
    {readError ? <ShopLoadFeedback error={readError} onRetry={retry} /> : null}
    {failed ? <Text accessibilityRole="alert" style={ui.content}>Could not confirm this shop. The price is still on this phone.</Text> : null}
    {shops && !readError && !shops.shops.length ? <Text style={ui.content}>Add a shop from Home before linking this price.</Text> : null}
    <ShopPicker title="Choose shop for saved price" shops={shops?.shops ?? []} isLoading={!shops || busy}
      error={readError} onSelect={onSelect} onCancel={() => { if (!busy) onCancel(); }} />
  </View>;
}
