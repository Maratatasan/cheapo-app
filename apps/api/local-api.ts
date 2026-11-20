import type { Pool } from 'pg';

import { createCatalogHandler, isCatalogPath } from './catalog.ts';
import { postgresCatalog } from './postgres-catalog.ts';
import { postgresPriceAppend } from './postgres-price-append.ts';
import { postgresPriceHistory } from './postgres-price-history.ts';
import { postgresSavedShops } from './postgres-saved-shops.ts';
import type { ShoppingQuery, ShoppingTransaction } from './postgres-shopping.ts';
import { postgresPreferences } from './postgres.ts';
import { createPreferencesHandler } from './preferences.ts';
import { createPriceHistoryHandler, isPriceHistoryPath } from './price-history.ts';
import { createSavedShopHandler, isSavedShopPath } from './saved-shops.ts';
import { createShoppingIdentityHandler } from './shopping-identity.ts';

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
}) {
  const preferences = createPreferencesHandler(postgresPreferences({ query }));
  const shops = createSavedShopHandler(postgresSavedShops(transaction));
  const catalog = createCatalogHandler(postgresCatalog(transaction));
  const prices = createPriceHistoryHandler(postgresPriceHistory(transaction), postgresPriceAppend(transaction));
  const identity = createShoppingIdentityHandler(query);
  return (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === '/v1/me') return identity(request);
    if (isSavedShopPath(path)) return shops(request);
    if (isCatalogPath(path)) return catalog(request);
    if (isPriceHistoryPath(path)) return prices(request);
    return preferences(request);
  };
}

export function createLocalApi(pool: Pool) {
  return createShoppingApi({
    query: (text, params) => pool.query(text, params),
    transaction: localTransaction(pool),
  });
}
