import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { cheapoShoppingReadCache } from '../data/cheapo-shopping-read-cache';
import type { PriceQueueOwner } from '../data/price-append-queue';
import { openProductPresentationPhotos } from '../data/product-presentation-photos-device';

import type { ProductPhotoSource } from './use-product-photo-uri';

function createProductPhotoSource(owner: PriceQueueOwner, signal: AbortSignal): ProductPhotoSource {
  const requests = new Map<string, ReturnType<ProductPhotoSource>>();
  const photos = openProductPresentationPhotos(owner);

  function load(id: string, mode?: 'cache-only') {
    return photos.read(id, signal, mode).then(
      result => !signal.aborted && 'photo' in result ? result.photo.uri : undefined,
      () => undefined,
    );
  }

  return (id: string) => {
    const existing = requests.get(id);
    if (existing) return existing;
    const cached = load(id, 'cache-only');
    const request = { cached, current: cached.then(() => signal.aborted ? undefined : load(id)) };
    requests.set(id, request);
    return request;
  };
}

export function useProductPhotoSource(owner?: PriceQueueOwner): ProductPhotoSource | undefined {
  const [scope, setScope] = useState<{ owner: PriceQueueOwner; signal: AbortSignal; source: ProductPhotoSource }>();

  useFocusEffect(useCallback(() => {
    if (!owner) return;
    const controller = new AbortController();
    try {
      setScope({ owner, signal: controller.signal, source: createProductPhotoSource(owner, controller.signal) });
    } catch {
      return;
    }
    const unsubscribe = cheapoShoppingReadCache.subscribeClear(() => {
      controller.abort();
      // Wait for the next focus before refilling a deliberately cleared cache.
      setScope(undefined);
    });
    return () => {
      controller.abort();
      unsubscribe();
      setScope(previous => previous?.signal === controller.signal ? undefined : previous);
    };
  }, [owner]));

  return scope && scope.owner === owner && !scope.signal.aborted ? scope.source : undefined;
}
