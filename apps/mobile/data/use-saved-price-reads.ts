import type { PriceObservation, PriceObservationDetail } from '@cheapo/domain/price-history';
import { useCallback, useRef, useState } from 'react';

import type { EvidenceView } from '../component/shared-price-evidence';
import { CheapoAccessError } from '../lib/cheapo-access/client';
import type { PriceEvidenceRole } from './cheapo-price-photo-read';
import { openCheapoSavedPriceReads } from './cheapo-shopping-read-device';
import type { PriceAppendQueue } from './price-append-queue';
import type { PendingHistoryChange } from './saved-price-history';

export type SavedPriceQueueRead = Pick<PriceAppendQueue, 'owner' | 'read'>;
type History = {
  queue: SavedPriceQueueRead;
  entries: Awaited<ReturnType<SavedPriceQueueRead['read']>>['entries'];
  observations: PriceObservation[];
  changes: readonly PendingHistoryChange[];
  nextCursor: string | null;
  status: 'loading' | 'fresh' | 'cached' | 'unavailable';
  lastSyncedAt?: string;
};
type Detail = { queue: SavedPriceQueueRead; id: string } & (
  { status: 'loading' | 'unavailable' } |
  { status: 'fresh' | 'cached'; lastSyncedAt: string; observation: PriceObservationDetail; role: PriceEvidenceRole | null; photo?: EvidenceView }
);

export function useSavedPriceReads(queue: SavedPriceQueueRead | null, loadPriceChanges?: () => Promise<readonly PendingHistoryChange[]>) {
  const [historyState, setHistory] = useState<History>();
  const [detailState, setDetail] = useState<Detail>();
  const detailWork = useRef<AbortController | null>(null);
  const history = historyState?.queue === queue ? historyState : undefined;
  const detail = detailState?.queue === queue ? detailState : undefined;

  const refresh = useCallback(async (signal: AbortSignal, cursor?: string) => {
    if (!queue) return;
    const empty: History = { queue, entries: [], observations: [], changes: [], nextCursor: null, status: 'loading' };
    setHistory(previous => previous?.queue === queue ? { ...previous, status: 'loading' } : empty);
    try {
      const session = await openCheapoSavedPriceReads(queue.owner);
      const [{ entries }, changes] = await Promise.all([queue.read(), loadPriceChanges?.() ?? []]);
      session.assertCurrent();
      if (signal.aborted) return;
      setHistory(previous => previous?.queue === queue ? { ...previous, entries, changes } : previous);
      const result = await session.loadPriceHistory({ includeRecordedInError: true, cursor }, signal);
      session.assertCurrent();
      if (signal.aborted) return;
      setHistory(previous => {
        if (previous?.queue !== queue) return previous;
        if (result.status === 'unavailable') {
          return cursor ? { ...previous, status: 'unavailable' } : { ...empty, entries, changes, status: 'unavailable' };
        }
        const observations = cursor ? [...previous.observations, ...result.value.observations] : result.value.observations;
        return { queue, entries, observations, changes, nextCursor: result.value.nextCursor, status: result.status, lastSyncedAt: result.lastSyncedAt };
      });
    } catch (error) {
      if (signal.aborted) return;
      setHistory(previous => previous?.queue === queue ? { ...empty, entries: previous.entries, changes: previous.changes, status: 'unavailable' } : previous);
      if (error instanceof CheapoAccessError) {
        detailWork.current?.abort();
        setDetail(previous => previous?.queue === queue ? { queue, id: previous.id, status: 'unavailable' } : previous);
      }
    }
  }, [queue, loadPriceChanges]);

  const abort = useCallback(() => { detailWork.current?.abort(); }, []);

  function close() {
    abort();
    setDetail(undefined);
  }

  async function open(id: string, requestedRole?: PriceEvidenceRole) {
    if (!queue) return;
    abort();
    const controller = new AbortController();
    detailWork.current = controller;
    const signal = controller.signal;
    setDetail({ queue, id, status: 'loading' });
    try {
      const session = await openCheapoSavedPriceReads(queue.owner);
      const result = await session.loadPriceObservation(id, signal);
      session.assertCurrent();
      if (signal.aborted) return;
      if (result.status === 'unavailable' || !result.value.observation) {
        setDetail({ queue, id, status: 'unavailable' });
        return;
      }
      const { observation } = result.value;
      const role = requestedRole && observation.photos.some(photo => photo.role === requestedRole)
        ? requestedRole : observation.selectedPhotoRole;
      const loaded: Detail = { queue, id, status: result.status, lastSyncedAt: result.lastSyncedAt, observation, role };
      setDetail(loaded);
      if (!role || !observation.photos.some(photo => photo.role === role && photo.availability !== 'pending')) return;
      try {
        const photo = await session.loadPhoto(id, role, signal);
        session.assertCurrent();
        if (signal.aborted) return;
        setDetail({ ...loaded, photo: photo.status === 'unavailable'
          ? { role, status: 'unavailable' } : { role, status: photo.status, uri: photo.value.uri } });
      } catch (error) {
        if (error instanceof CheapoAccessError) throw error;
        if (!signal.aborted) setDetail({ ...loaded, photo: { role, status: 'unavailable' } });
      }
    } catch {
      if (!signal.aborted) setDetail({ queue, id, status: 'unavailable' });
    }
  }

  return { history, detail, refresh, open, close, abort };
}
