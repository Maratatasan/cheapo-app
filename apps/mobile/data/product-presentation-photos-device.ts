import { cheapoAccess } from '../lib/cheapo-access/device';
import { CheapoAccessError } from '../lib/cheapo-access/client';
import { openOwnerReadSession } from './cheapo-shopping-read-device';
import { cheapoPricePhotoCache } from './cheapo-shopping-read-cache';
import type { PriceQueueOwner } from './price-append-queue';
import { createProductPresentationPhotos } from './product-presentation-photos';

export function openProductPresentationPhotos(owner: PriceQueueOwner) {
  if (!cheapoAccess) throw new CheapoAccessError('Cheapo shopping access is unavailable.');
  return createProductPresentationPhotos({ owner, openRead: () => openOwnerReadSession(owner),
    openWrite: cheapoAccess.openShoppingWriteSession, cache: cheapoPricePhotoCache });
}
