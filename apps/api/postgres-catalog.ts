import type { CatalogProduct, ExecuteCatalog } from './catalog.ts';
import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';

type ProductRow = {
  id: string;
  gtin: string | null;
  name: string;
  product_type: string | null;
  brand: string | null;
  variety: string | null;
  pack: CatalogProduct['pack'] | null;
  comparable_group_id: string | null;
};

const columns = 'id, gtin, name, product_type, brand, variety, pack, comparable_group_id';

function productFromRow(row: ProductRow): CatalogProduct {
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

export function postgresCatalog(transaction: ShoppingTransaction): ExecuteCatalog {
  return (digest, action) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };
    if (action.kind === 'find') {
      const column = action.key === 'barcode' ? 'gtin' : 'id';
      const { rows: [row] } = await query<ProductRow>(`SELECT ${columns} FROM cheapo.product WHERE ${column} = $1`, [action.value]);
      return { status: 'ok', product: row ? productFromRow(row) : null };
    }

    const { id, barcode, name, productType, brand, variety, pack, comparableGroupId } = action.product;
    const values = [id, barcode ?? null, name, productType ?? null, brand ?? null, variety ?? null, pack ?? null, comparableGroupId ?? null];
    const { rows: [inserted] } = await query<ProductRow>(`
      INSERT INTO cheapo.product (${columns}) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT DO NOTHING RETURNING ${columns}
    `, values);
    if (inserted) return { status: 'ok', product: productFromRow(inserted) };

    const { rows: [existing] } = await query<ProductRow & { identical: boolean }>(`
      SELECT ${columns},
        id = $1 AND gtin IS NOT DISTINCT FROM $2 AND name = $3
        AND product_type IS NOT DISTINCT FROM $4 AND brand IS NOT DISTINCT FROM $5
        AND variety IS NOT DISTINCT FROM $6 AND pack IS NOT DISTINCT FROM $7::jsonb
        AND comparable_group_id IS NOT DISTINCT FROM $8 AS identical
      FROM cheapo.product WHERE id = $1 OR gtin = $2
      ORDER BY (gtin = $2) DESC NULLS LAST LIMIT 1
    `, values);
    if (!existing) throw Error('Conflicting product changed during creation. Retry the request.');
    return { status: existing.identical ? 'ok' : 'conflict', product: productFromRow(existing) };
  });
}
