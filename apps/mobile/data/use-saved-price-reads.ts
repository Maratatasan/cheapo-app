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
type LoadedDetail = Extract<Detail, { observation: PriceObservationDetail }>;
type SavedPriceReads = Awaited<ReturnType<typeof openCheapoSavedPriceReads>>;

async function loadDisplayedPrice(
  session: SavedPriceReads,
  id: string,
  pendingChanges: readonly PendingHistoryChange[] | Promise<readonly PendingHistoryChange[]>,
  signal: AbortSignal,
  cacheOnly = false,
) {
  const load = cacheOnly ? session.cached.loadPriceObservation : session.loadPriceObservation;
  const [result, changes] = await Promise.all([load(id, signal), pendingChanges]);
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

function hasReadyPhoto({ observation, role }: LoadedDetail) {
  return !!role && viewedPricePhotoRoles(observation).some(photo => photo.role === role && photo.availability !== 'pending');
}

function samePhoto(first: LoadedDetail, second: LoadedDetail) {
  const a = first.observation;
  const b = second.observation;
  return first.id === second.id && first.role === second.role && a.version === b.version && a.cropSource === b.cropSource
    && a.cropBox?.left === b.cropBox?.left && a.cropBox?.top === b.cropBox?.top
    && a.cropBox?.right === b.cropBox?.right && a.cropBox?.bottom === b.cropBox?.bottom;
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
      const query = { includeRecordedInError: true as const, cursor };
      if (!cursor) {
        const saved = await session.cached.loadPriceHistory(query, controller.signal);
        session.assertCurrent();
        if (!latest()) return;
        if (saved.status === 'cached') setHistory(previous => latest() && previous?.queue === queue ? {
          queue, entries, changes, observations: saved.value.observations, nextCursor: saved.value.nextCursor,
          status: saved.status, lastSyncedAt: saved.lastSyncedAt,
        } : previous);
      }
      const result = await session.loadPriceHistory(query, controller.signal);
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

  const loadThumbnail = useCallback(async (id: string, changes: readonly PendingHistoryChange[], rowSignal: AbortSignal, version?: number) => {
    if (!queue || rowSignal.aborted) return;
    const controller = new AbortController();
    const { signal } = controller;
    const cancel = () => controller.abort();
    rowSignal.addEventListener('abort', cancel, { once: true });
    thumbnailWork.current.add(controller);
    try {
      const session = await openCheapoSavedPriceReads(queue.owner);
      if (signal.aborted) return;
      if (version !== undefined) {
        const saved = await loadDisplayedPrice(session, id, changes, signal, true);
        const observation = saved?.display;
        const role = observation?.selectedPhotoRole;
        if (observation?.version === version && role
          && viewedPricePhotoRoles(observation).some(photo => photo.role === role && photo.availability !== 'pending')) {
          const photo = await session.cached.loadSelectedPhoto(observation, role, signal);
          session.assertCurrent();
          if (!signal.aborted && photo.status !== 'unavailable') return photo.value.uri;
        }
      }
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
    const currentQueue = queue;
    abort();
    const controller = new AbortController();
    detailWork.current = controller;
    const signal = controller.signal;
    setDetail({ queue, id, status: 'loading' });
    function makeDetail(projected: NonNullable<Awaited<ReturnType<typeof loadDisplayedPrice>>>): LoadedDetail {
      const { display: observation, pending, status, lastSyncedAt } = projected;
      const role = requestedRole && viewedPricePhotoRoles(observation).some(photo => photo.role === requestedRole)
        ? requestedRole : observation.selectedPhotoRole;
      return { queue: currentQueue, id, status, lastSyncedAt, observation, role, pending };
    }
    try {
      const session = await openCheapoSavedPriceReads(queue.owner);
      const changes = loadPriceChanges?.() ?? [];
      const snapshot = await loadDisplayedPrice(session, id, changes, signal, true);
      let preview: LoadedDetail | undefined;
      if (snapshot) {
        preview = makeDetail(snapshot);
        const role = preview.role;
        if (role && hasReadyPhoto(preview)) {
          const photo = await session.cached.loadSelectedPhoto(preview.observation, role, signal);
          session.assertCurrent();
          if (photo.status !== 'unavailable') preview.photo = { role, status: 'cached', uri: photo.value.uri };
        }
        if (signal.aborted) return;
        setDetail(preview);
      }
      const projected = await loadDisplayedPrice(session, id, changes, signal);
      if (signal.aborted) return;
      if (!projected) {
        setDetail({ queue, id, status: 'unavailable' });
        return;
      }
      const loaded = makeDetail(projected);
      const { role, observation } = loaded;
      const ready = role && hasReadyPhoto(loaded);
      if (ready && preview?.photo && samePhoto(preview, loaded)) loaded.photo = preview.photo;
      setDetail(loaded);
      if (!ready || loaded.photo) return;
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
