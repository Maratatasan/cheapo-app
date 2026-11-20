import type { Pool } from 'pg';

import { createCatalogHandler, isCatalogPath } from './catalog.ts';
import { postgresCatalog } from './postgres-catalog.ts';
import { postgresPriceAppend } from './postgres-price-append.ts';
import { postgresPriceCorrection } from './postgres-price-correction.ts';
import { postgresPriceHistory } from './postgres-price-history.ts';
import { postgresPricePhoto } from './postgres-price-photo.ts';
import { postgresCompletePhotoUpload, postgresPhotoUpload } from './postgres-price-photo-upload.ts';
import { postgresSavedShops } from './postgres-saved-shops.ts';
import type { ShoppingQuery, ShoppingTransaction } from './postgres-shopping.ts';
import { postgresPreferences } from './postgres.ts';
import { createPreferencesHandler } from './preferences.ts';
import { createPriceHistoryHandler, isPriceHistoryPath } from './price-history.ts';
import { createPricePhotoHandler, isPricePhotoPath, type SignPricePhoto } from './price-photo.ts';
import { createPricePhotoUploadHandler, isPricePhotoUploadPath, type SignPhotoUpload, type VerifyPhotoObject } from './price-photo-upload.ts';
import { createSavedShopHandler, isSavedShopPath } from './saved-shops.ts';
import { createShoppingIdentityHandler } from './shopping-identity.ts';

type EvidenceStorage = { read?: SignPricePhoto; upload?: SignPhotoUpload; verify?: VerifyPhotoObject };

function localTransaction(pool: Pool): ShoppingTransaction {
  return async run => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await run((text, params) => client.query(text, params));
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}

export function createShoppingApi({ query, transaction }: {
  query: ShoppingQuery; transaction: ShoppingTransaction;
}, evidence: EvidenceStorage = {}) {
  const preferences = createPreferencesHandler(postgresPreferences({ query }));
  const shops = createSavedShopHandler(postgresSavedShops(transaction));
  const catalog = createCatalogHandler(postgresCatalog(transaction));
  const prices = createPriceHistoryHandler(
    postgresPriceHistory(transaction), postgresPriceAppend(transaction), postgresPriceCorrection(transaction),
  );
  const identity = createShoppingIdentityHandler(query);
  const photos = createPricePhotoHandler(postgresPricePhoto(transaction), evidence.read);
  const verify = evidence.verify ? postgresCompletePhotoUpload(transaction, evidence.verify) : undefined;
  const uploads = createPricePhotoUploadHandler(postgresPhotoUpload(transaction), evidence.upload, verify);
  return (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === '/v1/me') return identity(request);
    if (isSavedShopPath(path)) return shops(request);
    if (isCatalogPath(path)) return catalog(request);
    if (isPriceHistoryPath(path)) return prices(request);
    if (isPricePhotoPath(path)) return photos(request);
    if (isPricePhotoUploadPath(path)) return uploads(request);
    return preferences(request);
  };
}

export function createLocalApi(pool: Pool, evidence?: EvidenceStorage) {
  return createShoppingApi({
    query: (text, params) => pool.query(text, params),
    transaction: localTransaction(pool),
  }, evidence);
}
