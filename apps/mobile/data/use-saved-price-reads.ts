import type { PriceObservation, PriceObservationDetail } from '@cheapo/domain/price-history';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { EvidenceView } from '../component/shared-price-evidence';
import { CheapoAccessError } from '../lib/cheapo-access/client';
import type { PriceEvidenceRole } from './cheapo-price-photo-read';
import { cheapoShoppingReadCache } from './cheapo-shopping-read-cache';
import { openCheapoSavedPriceReads } from './cheapo-shopping-read-device';
import type { PriceAppendQueue } from './price-append-queue';
import { keptSharedPrice, projectSharedPrice, type PendingHistoryChange, type PendingPriceState } from './saved-price-history';
import { viewedPricePhotoRoles } from './selected-price-photo-read';

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
  { status: 'fresh' | 'cached'; lastSyncedAt?: string; observation: PriceObservationDetail; role: PriceEvidenceRole | null; photo?: EvidenceView; pending?: PendingPriceState }
);

async function loadDisplayedPrice(
  session: Awaited<ReturnType<typeof openCheapoSavedPriceReads>>,
  id: string,
  pendingChanges: readonly PendingHistoryChange[] | Promise<readonly PendingHistoryChange[]>,
  signal: AbortSignal,
) {
  const [result, changes] = await Promise.all([session.loadPriceObservation(id, signal), pendingChanges]);
  session.assertCurrent();
  if (signal.aborted) return;
  const read = result.status === 'unavailable' ? undefined : result;
  const current = read?.value.observation;
  const kept = current || read?.status !== 'fresh' ? keptSharedPrice(id, changes, current?.version) : undefined;
  const observed = kept ?? current;
  if (!observed) return;
  return { ...projectSharedPrice(observed, changes), status: kept ? 'cached' as const : read?.status ?? 'cached',
    lastSyncedAt: read?.lastSyncedAt };
}

export function useSavedPriceReads(queue: SavedPriceQueueRead | null, loadPriceChanges?: () => Promise<readonly PendingHistoryChange[]>) {
  const [historyState, setHistory] = useState<History>();
  const [detailState, setDetail] = useState<Detail>();
  const historyWork = useRef<AbortController | null>(null);
  const detailWork = useRef<AbortController | null>(null);
  const thumbnailWork = useRef(new Set<AbortController>());
  const history = historyState?.queue === queue ? historyState : undefined;
  const detail = detailState?.queue === queue ? detailState : undefined;

  useEffect(() => {
    if (!queue) return;
    return cheapoShoppingReadCache.subscribeClear(() => {
      historyWork.current?.abort();
      detailWork.current?.abort();
      for (const controller of thumbnailWork.current) controller.abort();
      setHistory(previous => previous?.queue === queue
        ? { ...previous, observations: [], status: 'unavailable', nextCursor: null, lastSyncedAt: undefined } : previous);
      setDetail(previous => previous?.queue === queue ? undefined : previous);
    });
  }, [queue]);

  const refresh = useCallback(async (signal: AbortSignal, cursor?: string) => {
    if (!queue || signal.aborted) return;
    historyWork.current?.abort();
    const controller = new AbortController();
    historyWork.current = controller;
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const latest = () => !signal.aborted && !controller.signal.aborted;
    const empty: History = { queue, entries: [], observations: [], changes: [], nextCursor: null, status: 'loading' };
    setHistory(previous => !latest() ? previous : previous?.queue === queue ? { ...previous, status: 'loading' } : empty);
    try {
      const session = await openCheapoSavedPriceReads(queue.owner);
      const [{ entries }, changes] = await Promise.all([queue.read(), loadPriceChanges?.() ?? []]);
      session.assertCurrent();
      if (!latest()) return;
      setHistory(previous => latest() && previous?.queue === queue ? { ...previous, entries } : previous);
      const result = await session.loadPriceHistory({ includeRecordedInError: true, cursor }, controller.signal);
      session.assertCurrent();
      if (!latest()) return;
      setHistory(previous => {
        if (!latest() || previous?.queue !== queue) return previous;
        if (result.status === 'unavailable') {
          return cursor ? { ...previous, status: 'unavailable' } : { ...empty, entries, changes, status: 'unavailable' };
        }
        const observations = cursor ? [...previous.observations, ...result.value.observations] : result.value.observations;
        return { queue, entries, observations, changes, nextCursor: result.value.nextCursor, status: result.status, lastSyncedAt: result.lastSyncedAt };
      });
    } catch (error) {
      if (!latest()) return;
      setHistory(previous => latest() && previous?.queue === queue ? { ...empty, entries: previous.entries, changes: error instanceof CheapoAccessError ? [] : previous.changes, status: 'unavailable' } : previous);
      if (error instanceof CheapoAccessError) {
        detailWork.current?.abort();
        setDetail(previous => latest() && previous?.queue === queue ? { queue, id: previous.id, status: 'unavailable' } : previous);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }, [queue, loadPriceChanges]);

  const abort = useCallback(() => {
    detailWork.current?.abort();
    for (const controller of thumbnailWork.current) controller.abort();
  }, []);

  const loadThumbnail = useCallback(async (id: string, changes: readonly PendingHistoryChange[], rowSignal: AbortSignal) => {
    if (!queue || rowSignal.aborted) return;
    const controller = new AbortController();
    const { signal } = controller;
    const cancel = () => controller.abort();
    rowSignal.addEventListener('abort', cancel, { once: true });
    thumbnailWork.current.add(controller);
    try {
      const session = await openCheapoSavedPriceReads(queue.owner);
      if (signal.aborted) return;
      const loaded = await loadDisplayedPrice(session, id, changes, signal);
      if (!loaded) return;
      const observation = loaded.display;
      const role = observation.selectedPhotoRole;
      if (!role || !viewedPricePhotoRoles(observation).some(photo => photo.role === role && photo.availability !== 'pending')) return;
      const photo = await session.loadSelectedPhoto(observation, role, signal);
      session.assertCurrent();
      if (!signal.aborted && photo.status !== 'unavailable') return photo.value.uri;
    } finally {
      rowSignal.removeEventListener('abort', cancel);
      thumbnailWork.current.delete(controller);
    }
  }, [queue]);

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
      const projected = await loadDisplayedPrice(session, id, loadPriceChanges?.() ?? [], signal);
      if (signal.aborted) return;
      if (!projected) {
        setDetail({ queue, id, status: 'unavailable' });
        return;
      }
      const { display: observation, pending, status, lastSyncedAt } = projected;
      const displayedRoles = viewedPricePhotoRoles(observation);
      const role = requestedRole && displayedRoles.some(photo => photo.role === requestedRole)
        ? requestedRole : observation.selectedPhotoRole;
      const loaded: Detail = { queue, id, status, lastSyncedAt, observation, role, pending };
      setDetail(loaded);
      if (!role || !displayedRoles.some(photo => photo.role === role && photo.availability !== 'pending')) return;
      try {
        const photo = await session.loadSelectedPhoto(observation, role, signal);
        session.assertCurrent();
        if (signal.aborted) return;
        setDetail({ ...loaded, photo: photo.status === 'unavailable'
          ? { role, status: 'unavailable' } : { role, status: photo.status, uri: photo.value.uri } });
      } catch (error) {
        if (error instanceof CheapoAccessError) throw error;
        if (!signal.aborted) setDetail({ ...loaded, photo: { role, status: 'unavailable' } });
      }
    } catch (error) {
      if (signal.aborted) return;
      setDetail({ queue, id, status: 'unavailable' });
      if (error instanceof CheapoAccessError) {
        historyWork.current?.abort();
        setHistory(previous => previous?.queue === queue
          ? { ...previous, observations: [], changes: [], status: 'unavailable', nextCursor: null, lastSyncedAt: undefined }
          : previous);
      }
    }
  }

  return { history, detail, refresh, open, close, abort, loadThumbnail };
}
