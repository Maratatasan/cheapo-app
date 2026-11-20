import type { Pool } from 'pg';

import { postgresSavedShops, type ShopTransaction } from './postgres-saved-shops.ts';
import { postgresPreferences } from './postgres.ts';
import { createPreferencesHandler } from './preferences.ts';
import { createSavedShopHandler, isSavedShopPath } from './saved-shops.ts';

function localTransaction(pool: Pool): ShopTransaction {
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

export function createLocalApi(pool: Pool) {
  const preferences = createPreferencesHandler(postgresPreferences(pool));
  const shops = createSavedShopHandler(postgresSavedShops(localTransaction(pool)));
  return (request: Request) => isSavedShopPath(new URL(request.url).pathname) ? shops(request) : preferences(request);
}
