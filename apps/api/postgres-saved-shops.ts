import { shopDisplayName, type Shop } from '@cheapo/domain';

import type { ExecuteSavedShop, SavedShopState, ShopAction } from './saved-shops.ts';

import { readShoppingMember, type ShoppingMember, type ShoppingQuery, type ShoppingTransaction } from './postgres-shopping.ts';

type ShopRow = Omit<Shop, 'name' | 'nickname' | 'address' | 'location'> & {
  name: string | null; nickname: string | null; address: string | null; location: Shop['location'] | null;
  selected: boolean; test_shop: boolean | null;
};

async function readSavedShops(query: ShoppingQuery, member: ShoppingMember): Promise<SavedShopState> {
  const { rows } = await query<ShopRow>(`
    SELECT shop.id, shop.name, shop.address, shop.location, link.nickname,
      link.source_test_shop AS test_shop,
      selection.shop_id IS NOT NULL AS selected
    FROM cheapo.household_saved_shop AS link
    JOIN cheapo.shop AS shop ON shop.id = link.shop_id
    LEFT JOIN cheapo.shopper_current_shop AS selection
      ON selection.household_id = link.household_id AND selection.shop_id = link.shop_id AND selection.shopper_id = $2::uuid
    WHERE link.household_id = $1::uuid
    ORDER BY lower(coalesce(link.nickname, shop.name)), shop.id
  `, [member.household_id, member.shopper_id]);
  const shops = rows.map(({ id, name, nickname, address, location, test_shop }) => ({
    id, name: name ?? undefined, nickname: nickname ?? undefined,
    address: address ?? undefined, location: location ?? undefined, testShop: test_shop ?? undefined,
  }));
  const currentShop = shops[rows.findIndex(row => row.selected)];
  return currentShop ? { shops, currentShop } : { shops };
}

async function selectShop(query: ShoppingQuery, member: ShoppingMember, shopId: string) {
  await query(`
    INSERT INTO cheapo.shopper_current_shop (household_id, shopper_id, shop_id) VALUES ($1::uuid, $2::uuid, $3)
    ON CONFLICT (household_id, shopper_id) DO UPDATE SET shop_id = EXCLUDED.shop_id
  `, [member.household_id, member.shopper_id, shopId]);
}

type ShopChange = 'ok' | 'shop_not_saved' | 'invalid_shop';

async function changeShop(query: ShoppingQuery, member: ShoppingMember, action: Exclude<ShopAction, { kind: 'read' }>): Promise<ShopChange> {
  const household = member.household_id;
  // The household's link and any affected selections change together.
  await query('SELECT id FROM cheapo.household WHERE id = $1::uuid FOR UPDATE', [household]);
  if (action.kind === 'save') {
    const { id, name, nickname, address, location } = action.shop;
    await query(`
      INSERT INTO cheapo.shop (id, name, address, location) VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (id) DO NOTHING
    `, [id, name ?? null, address ?? null, location ?? null]);
    const { rows: [branch] } = await query<{ name: string | null; nickname: string | null }>(`
      SELECT shop.name, link.nickname FROM cheapo.shop AS shop
      LEFT JOIN cheapo.household_saved_shop AS link ON link.shop_id = shop.id AND link.household_id = $1::uuid
      WHERE shop.id = $2
      FOR SHARE OF shop
    `, [household, id]);
    if (!shopDisplayName({ name: branch.name ?? undefined, nickname: branch.nickname ?? nickname })) return 'invalid_shop';
    await query(`
      INSERT INTO cheapo.household_saved_shop (household_id, shop_id, nickname) VALUES ($1::uuid, $2, $3)
      ON CONFLICT (household_id, shop_id) DO NOTHING
    `, [household, id, nickname ?? null]);
    if (action.select) await selectShop(query, member, id);
    return 'ok';
  }
  if (action.kind === 'unlink') {
    await query('DELETE FROM cheapo.shopper_current_shop WHERE household_id = $1::uuid AND shop_id = $2', [household, action.shopId]);
    await query('DELETE FROM cheapo.household_saved_shop WHERE household_id = $1::uuid AND shop_id = $2', [household, action.shopId]);
    return 'ok';
  }
  const { shopId } = action;
  const { rows: [current] } = await query<Pick<ShopRow, 'name' | 'nickname' | 'address'>>(`
    SELECT shop.name, shop.address, link.nickname FROM cheapo.household_saved_shop AS link
    JOIN cheapo.shop AS shop ON shop.id = link.shop_id
    WHERE link.household_id = $1::uuid AND link.shop_id = $2
    FOR UPDATE OF shop
  `, [household, shopId]);
  if (!current) return 'shop_not_saved';
  if (action.kind === 'select') {
    await selectShop(query, member, shopId);
    return 'ok';
  }
  if (action.kind === 'edit') {
    const { details } = action;
    const name = 'name' in details ? details.name : current.name;
    const nickname = 'nickname' in details ? details.nickname : current.nickname;
    const address = 'address' in details ? details.address : current.address;
    if (!shopDisplayName({ name: name ?? undefined, nickname: nickname ?? undefined })) return 'invalid_shop';
    if (!name && current.name) {
      const { rows } = await query(`
        SELECT 1 FROM cheapo.household_saved_shop WHERE shop_id = $1 AND household_id <> $2::uuid AND nickname IS NULL LIMIT 1
      `, [shopId, household]);
      if (rows.length) return 'invalid_shop';
    }
    await query('UPDATE cheapo.shop SET name = $2, address = $3 WHERE id = $1', [shopId, name ?? null, address ?? null]);
    await query('UPDATE cheapo.household_saved_shop SET nickname = $3 WHERE household_id = $1::uuid AND shop_id = $2', [household, shopId, nickname ?? null]);
  }
  return 'ok';
}

export function postgresSavedShops(transaction: ShoppingTransaction): ExecuteSavedShop {
  return (digest, action) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };
    if (action.kind !== 'read') {
      const status = await changeShop(query, member, action);
      if (status !== 'ok') return { status };
    }
    return { status: 'ok', state: await readSavedShops(query, member) };
  });
}
