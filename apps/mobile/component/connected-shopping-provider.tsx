import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { sameShoppingOwner, type PriceQueueOwner } from '@/data/price-append-queue';
import { openCheapoShopping, type CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';
import { cheapoAccess } from '@/lib/cheapo-access/device';
import { watchShoppingSync } from '@/lib/shopping-sync-lifecycle';
import { CheapoShoppingProvider } from './cheapo-shopping-provider';
import { DisplayState } from './results/display-state';
import { ui } from './results/theme';

type Selection = { status: 'loading' | 'unavailable' } | { status: 'ready'; runtime: CheapoShoppingRuntime | null };

export function ConnectedShoppingProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection>(cheapoAccess ? { status: 'loading' } : { status: 'ready', runtime: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const access = cheapoAccess;
    if (!access) return;
    let revision = 0;
    let active = true;
    let selected: CheapoShoppingRuntime | null = null;

    const select = async (expected?: PriceQueueOwner | null) => {
      const current = ++revision;
      if (expected === null) {
        selected = null;
        setSelection({ status: 'ready', runtime: null });
        return;
      }
      if (!selected || expected && !sameShoppingOwner(selected.owner, expected)) setSelection({ status: 'loading' });

      try {
        const next = await openCheapoShopping(access);
        if (!active || current !== revision) return;
        if (expected && !sameShoppingOwner(next?.owner ?? null, expected)) {
          setSelection({ status: 'unavailable' });
          return;
        }
        if (!next || !sameShoppingOwner(selected?.owner ?? null, next.owner)) selected = next;
        setSelection({ status: 'ready', runtime: selected });
      } catch {
        if (active && current === revision) setSelection({ status: 'unavailable' });
      }
    };

    const unsubscribe = access.subscribeEnrollment(owner => { void select(owner); });
    void select();
    return () => { active = false; unsubscribe(); };
  }, [attempt]);

  useEffect(() => {
    const runtime = selection.status === 'ready' ? selection.runtime : null;
    return runtime ? watchShoppingSync(() => { void runtime.retry().catch(() => {}); }) : undefined;
  }, [selection]);

  if (selection.status !== 'ready') {
    return <View style={ui.content}>
      {selection.status === 'loading' ? <DisplayState kind="loading" title="Opening shopping" description="Checking this phone’s Cheapo access." />
        : <DisplayState kind="empty" title="Shopping unavailable" description="Could not open this phone’s shopping data."
          actionLabel="Try again" onAction={() => setAttempt(value => value + 1)} />}
    </View>;
  }
  const { runtime } = selection;
  const owner = runtime?.owner;
  const key = owner ? JSON.stringify([owner.origin, owner.householdId, owner.shopperId]) : 'local-shopping';
  return <CheapoShoppingProvider key={key} runtime={runtime}>{children}</CheapoShoppingProvider>;
}
