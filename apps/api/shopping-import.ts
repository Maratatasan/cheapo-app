import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import type { planShoppingImport } from './shopping-import-plan.ts';

type ImportPlan = Awaited<ReturnType<typeof planShoppingImport>>;
type Photo = ImportPlan['photos'][number];
type Owner = { householdId: string; shopperId: string };
type SqlValue = string | number | boolean | string[] | null;
type Row = Record<string, SqlValue>;

type Table = 'shop' | 'household_saved_shop' | 'shopper_current_shop' | 'product'
  | 'catalog_revision' | 'price_observation' | 'price_photo' | 'shopping_import_receipt';

function json(data: object | null | undefined) {
  return data ? JSON.stringify(data) : null;
}

function priceAmount(price: string | undefined) {
  const digits = price?.trim();
  if (!digits || !/^\d+(?:\.\d{1,2})?$/.test(digits) || Number(digits) <= 0 || Number(digits) > 9_999_999.99) return null;
  return digits;
}

// Table and column identifiers come only from the literals below. Backup
// values always travel separately as SQL parameters.
async function keepExactRow(client: PoolClient, table: Table, row: Row) {
  const columns = Object.keys(row);
  const values = Object.values(row);
  const parameters = columns.map((_, index) => `$${index + 1}`);
  const inserted = await client.query(`INSERT INTO cheapo.${table} (${columns.join(', ')})
    VALUES (${parameters.join(', ')}) ON CONFLICT DO NOTHING`, values);
  if (inserted.rowCount === 1) return;

  const comparison = columns.map((column, index) => `${column} IS NOT DISTINCT FROM ${parameters[index]}`);
  const existing = await client.query(`SELECT 1 FROM cheapo.${table} WHERE ${comparison.join(' AND ')}`, values);
  if (existing.rowCount !== 1) throw new Error(`A stored ${table.replaceAll('_', ' ')} conflicts with the backup.`);
}

/**
 * Apply one validated snapshot to an explicitly selected owner. The resolver
 * must make each immutable photo available and return its verified storage key.
 * A database failure rolls every row back. Retrying uses the same photo keys.
 */
export async function applyShoppingImport(
  pool: Pool, owner: Owner, plan: ImportPlan, ensurePhoto: (photo: Photo) => Promise<string>,
) {
  const identity = { household_id: owner.householdId, shopper_id: owner.shopperId };
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const member = await client.query(`SELECT 1 FROM cheapo.household_membership
      WHERE household_id = $1 AND shopper_id = $2 AND revoked_at IS NULL`, [owner.householdId, owner.shopperId]);
    if (member.rowCount !== 1) throw new Error('The selected shopper must belong to the target household.');

    for (const shop of plan.shops) {
      await keepExactRow(client, 'shop', {
        id: shop.id, name: shop.name ?? null, address: shop.address ?? null, location: json(shop.location),
      });
      await keepExactRow(client, 'household_saved_shop', {
        household_id: owner.householdId, shop_id: shop.id, nickname: shop.nickname ?? null, source_test_shop: shop.testShop,
      });
    }
    if (plan.currentShopId) {
      await keepExactRow(client, 'shopper_current_shop', { ...identity, shop_id: plan.currentShopId });
    } else if (plan.summary.hasCurrentShopSelection) {
      const existing = await client.query(`SELECT 1 FROM cheapo.shopper_current_shop
        WHERE household_id = $1 AND shopper_id = $2`, [owner.householdId, owner.shopperId]);
      if (existing.rowCount) throw new Error('The existing current shop conflicts with the empty backup selection.');
    }

    for (const product of plan.products) {
      await keepExactRow(client, 'product', {
        id: product.id, gtin: product.gtin, name: product.name, product_type: product.productType ?? null,
        brand: product.brand ?? null, variety: product.variety ?? null, pack: json(product.pack),
        comparable_group_id: product.comparableGroupId ?? null, source_photo_ids: product.photoIds ?? null,
      });
    }
    for (const revision of plan.revisions) {
      await keepExactRow(client, 'catalog_revision', {
        ...identity, revision: revision.revision, product_id: revision.product.id,
        previous_gtin: revision.previous ?? null, product_snapshot: json(revision.product),
      });
    }
    for (const observation of plan.observations) {
      const currency = observation.review?.currency;
      await keepExactRow(client, 'price_observation', {
        ...identity, id: observation.id, product_id: observation.linkedProductId, shop_id: observation.linkedShopId,
        source_product_id: observation.productId ?? null, source_shop_id: observation.shop?.id ?? null,
        source_product_name: observation.productName, shop_display_name: observation.shop?.displayName ?? null,
        source_test_shop: observation.testShop, captured_at: observation.capturedAt, status: observation.status,
        price_amount: priceAmount(observation.review?.price), currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
        review: json(observation.review), unit_price: json(observation.unitPrice), crop_box: json(observation.cropBox),
      });
    }
    for (const photo of plan.photos) {
      const storageKey = await ensurePhoto(photo);
      await keepExactRow(client, 'price_photo', {
        ...identity, observation_id: photo.observationId, role: photo.role, storage_key: storageKey,
        sha256: photo.sha256, byte_count: photo.bytes, width: photo.width, height: photo.height,
      });
    }

    // The receipt represents exact source provenance, including both photo
    // hashes. It never bypasses row reconciliation on a retry.
    const sha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    await keepExactRow(client, 'shopping_import_receipt', {
      ...identity, sha256, version: plan.summary.version, exported_at: plan.exportedAt,
      source: json(plan.source), source_catalog: json(plan.sourceCatalog),
    });
    await client.query('COMMIT');
    return { ...plan.summary, sha256 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
