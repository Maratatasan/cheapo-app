import type { CatalogAction, CatalogProduct, CatalogResult, ExecuteCatalog } from './catalog.ts';
import { readShoppingReceipt, saveShoppingReceipt } from './postgres-shopping-receipt.ts';
import { readShoppingMember, type ShoppingMember, type ShoppingQuery, type ShoppingTransaction } from './postgres-shopping.ts';

export type ProductRow = {
  id: string;
  gtin: string | null;
  name: string;
  product_type: string | null;
  brand: string | null;
  variety: string | null;
  pack: CatalogProduct['pack'] | null;
  comparable_group_id: string | null;
  record_version: number;
};

export const productColumns = 'id, gtin, name, product_type, brand, variety, pack, comparable_group_id';
const resultColumns = productColumns + ', record_version';

export function productFromRow(row: Omit<ProductRow, 'record_version'>): CatalogProduct {
  return {
    id: row.id,
    barcode: row.gtin ?? undefined,
    name: row.name,
    productType: row.product_type ?? undefined,
    brand: row.brand ?? undefined,
    variety: row.variety ?? undefined,
    pack: row.pack ?? undefined,
    comparableGroupId: row.comparable_group_id ?? undefined,
  };
}

function productValues({ id, barcode, name, productType, brand, variety, pack, comparableGroupId }: CatalogProduct) {
  return [id, barcode ?? null, name, productType ?? null, brand ?? null, variety ?? null, pack ?? null, comparableGroupId ?? null];
}

async function lockBarcode(query: ShoppingQuery, barcode?: string) {
  if (barcode) await query(
    'SELECT 1 FROM pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))',
    [`cheapo:product-barcode:${barcode}`],
  );
}

async function correctProduct(
  query: ShoppingQuery, member: ShoppingMember, action: Extract<CatalogAction, { kind: 'correct' }>,
): Promise<CatalogResult> {
  const { product, expectedVersion, operationId } = action;
  const id = product.id;
  const { rows: [replay] } = await query<{ matches: boolean; product: CatalogProduct; version: number }>(`
    SELECT product_id = $4 AND operation_request = $5::jsonb AS matches, after_state AS product, version
    FROM cheapo.product_revision
    WHERE household_id = $1::uuid AND actor_shopper_id = $2::uuid AND operation_id = $3
  `, [member.household_id, member.shopper_id, operationId, id, action]);
  if (replay) return replay.matches
    ? { status: 'corrected', product: replay.product, version: replay.version }
    : { status: 'operation_conflict' };

  await lockBarcode(query, product.barcode);
  const { rows: [before] } = await query<ProductRow>(
    `SELECT ${resultColumns} FROM cheapo.product WHERE id = $1 FOR UPDATE`, [id],
  );
  if (!before) return { status: 'not_found' };
  if (before.record_version !== expectedVersion) {
    return { status: 'version_conflict', current: productFromRow(before), currentVersion: before.record_version };
  }

  if (product.barcode) {
    const { rows: [collision] } = await query<ProductRow>(
      `SELECT ${resultColumns} FROM cheapo.product WHERE gtin = $1 AND id <> $2`, [product.barcode, id],
    );
    if (collision) return { status: 'conflict', product: productFromRow(collision) };
  }
  const { rows: [after] } = await query<ProductRow>(`
    UPDATE cheapo.product
    SET gtin = $2, name = $3, product_type = $4, brand = $5, variety = $6,
      pack = $7::jsonb, comparable_group_id = $8, record_version = record_version + 1
    WHERE id = $1
    RETURNING ${resultColumns}
  `, productValues(product));
  const updatedProduct = productFromRow(after);
  await query(`
    INSERT INTO cheapo.product_revision
      (product_id, version, household_id, actor_shopper_id, operation_id, operation_request, before_state, after_state)
    VALUES ($1, $2::int, $3::uuid, $4::uuid, $5, $6::jsonb, $7::jsonb, $8::jsonb)
  `, [id, after.record_version, member.household_id, member.shopper_id, operationId, action, productFromRow(before), updatedProduct]);
  return { status: 'corrected', product: updatedProduct, version: after.record_version };
}

async function createProduct(
  query: ShoppingQuery, member: ShoppingMember, action: Extract<CatalogAction, { kind: 'create' }>,
): Promise<CatalogResult> {
  const operation = action.operationId
    ? { kind: 'product' as const, id: action.product.id, operationId: action.operationId, request: action }
    : undefined;
  if (operation) {
    const receipt = await readShoppingReceipt<{ product: CatalogProduct; version: number }>(query, member, operation);
    if (receipt) return receipt.matches ? { status: 'created', ...receipt.response } : { status: 'operation_conflict' };
  }

  async function accept(row: ProductRow): Promise<CatalogResult> {
    const response = { product: productFromRow(row), version: row.record_version };
    if (!operation) return { status: 'ok', ...response };
    await saveShoppingReceipt(query, member, operation, response);
    return { status: 'created', ...response };
  }

  await lockBarcode(query, action.product.barcode);
  const values = productValues(action.product);
  const { rows: [inserted] } = await query<ProductRow>(`
    INSERT INTO cheapo.product (${productColumns}) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    ON CONFLICT DO NOTHING RETURNING ${resultColumns}
  `, values);
  if (inserted) return accept(inserted);

  const { rows: [existing] } = await query<ProductRow & { identical: boolean }>(`
    SELECT ${resultColumns},
      id = $1 AND gtin IS NOT DISTINCT FROM $2 AND name = $3
      AND product_type IS NOT DISTINCT FROM $4 AND brand IS NOT DISTINCT FROM $5
      AND variety IS NOT DISTINCT FROM $6 AND pack IS NOT DISTINCT FROM $7::jsonb
      AND comparable_group_id IS NOT DISTINCT FROM $8 AS identical
    FROM cheapo.product WHERE id = $1 OR gtin = $2
    ORDER BY (gtin = $2) DESC NULLS LAST LIMIT 1
  `, values);
  if (!existing) throw Error('Conflicting product changed during creation. Retry the request.');
  return existing.identical ? accept(existing) : { status: 'conflict', product: productFromRow(existing) };
}

export function postgresCatalog(transaction: ShoppingTransaction): ExecuteCatalog {
  return (digest, action) => transaction(async query => {
    const lockHousehold = action.kind === 'correct' || (action.kind === 'create' && Boolean(action.operationId));
    const member = await readShoppingMember(query, digest, lockHousehold);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };
    if (action.kind === 'correct') return correctProduct(query, member, action);
    if (action.kind === 'find') {
      const column = action.key === 'barcode' ? 'gtin' : 'id';
      const { rows: [row] } = await query<ProductRow>(`SELECT ${resultColumns} FROM cheapo.product WHERE ${column} = $1`, [action.value]);
      return { status: 'ok', product: row ? productFromRow(row) : null, version: row?.record_version };
    }

    return createProduct(query, member, action);
  });
}
