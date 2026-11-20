import { shopDisplayName, type Shop } from '@cheapo/domain';

import type {
  ExecuteSavedShop, SavedShopResult, SavedShopState, ShopAction, ShopCandidate, VersionedSavedShop,
} from './saved-shops.ts';
import { readShoppingReceipt, saveShoppingReceipt } from './postgres-shopping-receipt.ts';
import { readShoppingMember, type ShoppingMember, type ShoppingQuery, type ShoppingTransaction } from './postgres-shopping.ts';

type BranchRow = { id: string; name: string | null; address: string | null; location: Shop['location'] | null };
type ShopRow = BranchRow & { nickname: string | null; test_shop: boolean | null };
type ShopDetailRow = ShopRow & { record_version: number; link_revision: string };

function branchFields({ id, name, address, location }: BranchRow): ShopCandidate {
  return { id, name: name ?? undefined, address: address ?? undefined, location: location ?? undefined };
}

async function findShopCandidates(query: ShoppingQuery, nameOrAddress: string): Promise<ShopCandidate[]> {
  const { rows } = await query<BranchRow>(`
    SELECT id, name, address, location FROM cheapo.shop
    WHERE strpos(lower(coalesce(name, '')), lower($1)) > 0
       OR strpos(lower(coalesce(address, '')), lower($1)) > 0
    ORDER BY lower(name) NULLS LAST, lower(address) NULLS LAST, id
    LIMIT 20
  `, [nameOrAddress]);
  return rows.map(branchFields);
}

function savedFields(row: ShopRow) {
  return { ...branchFields(row), nickname: row.nickname ?? undefined, testShop: row.test_shop ?? undefined };
}

function shopVersion(row: ShopDetailRow) {
  return `${row.record_version}:${row.link_revision}`;
}

async function readSavedShops(query: ShoppingQuery, member: ShoppingMember, includeVersions = false): Promise<SavedShopState> {
  const { rows } = await query<ShopDetailRow & { selected: boolean }>(`
    SELECT shop.id, shop.name, shop.address, shop.location, link.nickname,
      shop.record_version, link.link_revision, link.source_test_shop AS test_shop,
      selection.shop_id IS NOT NULL AS selected
    FROM cheapo.household_saved_shop AS link
    JOIN cheapo.shop AS shop ON shop.id = link.shop_id
    LEFT JOIN cheapo.shopper_current_shop AS selection
      ON selection.household_id = link.household_id AND selection.shop_id = link.shop_id AND selection.shopper_id = $2::uuid
    WHERE link.household_id = $1::uuid
    ORDER BY lower(coalesce(link.nickname, shop.name)), shop.id
  `, [member.household_id, member.shopper_id]);
  const shops = rows.map(savedFields);
  const currentShop = shops[rows.findIndex(row => row.selected)];
  const state = currentShop ? { shops, currentShop } : { shops };
  return includeVersions ? { ...state, versions: rows.map(row => ({ shopId: row.id, version: shopVersion(row) })) } : state;
}

async function readSavedShop(
  query: ShoppingQuery, household: string, shopId: string, lock = false,
): Promise<VersionedSavedShop | undefined> {
  const { rows: [row] } = await query<ShopDetailRow>(`
    SELECT shop.id, shop.name, shop.address, shop.location, shop.record_version,
      link.nickname, link.source_test_shop AS test_shop, link.link_revision
    FROM cheapo.household_saved_shop AS link JOIN cheapo.shop AS shop ON shop.id = link.shop_id
    WHERE link.household_id = $1::uuid AND link.shop_id = $2
    ${lock ? 'FOR UPDATE OF shop' : ''}
  `, [household, shopId]);
  return row ? { shop: savedFields(row), version: shopVersion(row) } : undefined;
}

async function selectShop(query: ShoppingQuery, member: ShoppingMember, shopId: string) {
  await query(`
    INSERT INTO cheapo.shopper_current_shop (household_id, shopper_id, shop_id) VALUES ($1::uuid, $2::uuid, $3)
    ON CONFLICT (household_id, shopper_id) DO UPDATE SET shop_id = EXCLUDED.shop_id
  `, [member.household_id, member.shopper_id, shopId]);
}

type ShopChange = 'ok' | 'shop_not_saved' | 'invalid_shop';

async function changeShop(query: ShoppingQuery, member: ShoppingMember,
  action: Exclude<ShopAction, { kind: 'read' | 'detail' | 'candidates' | 'edit' }>,
): Promise<ShopChange> {
  const household = member.household_id;
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
  if (!await readSavedShop(query, household, action.shopId, true)) return 'shop_not_saved';
  await selectShop(query, member, action.shopId);
  return 'ok';
}

async function editShop(query: ShoppingQuery, member: ShoppingMember, action: Extract<ShopAction, { kind: 'edit' }>): Promise<SavedShopResult> {
  const household = member.household_id;
  const { shopId, details, operation } = action;
  if (operation) {
    const { rows: [replay] } = await query<{ matches: boolean; detail: VersionedSavedShop }>(`
      SELECT shop_id = $4 AND operation_request = $5::jsonb AS matches, after_state AS detail
      FROM cheapo.saved_shop_revision
      WHERE household_id = $1::uuid AND actor_shopper_id = $2::uuid AND operation_id = $3
    `, [household, member.shopper_id, operation.operationId, shopId, action]);
    if (replay) return replay.matches ? { status: 'detail', detail: replay.detail } : { status: 'operation_conflict' };
  }

  // A branch edit and a private nickname edit share one guard. Other homes see only the branch version change.
  const before = await readSavedShop(query, household, shopId, true);
  if (!before) return { status: 'shop_not_saved' };
  if (operation && operation.expectedVersion !== before.version) return { status: 'version_conflict', current: before };
  const { shop: current } = before;
  const name = 'name' in details ? details.name : current.name;
  const nickname = 'nickname' in details ? details.nickname : current.nickname;
  const address = 'address' in details ? details.address : current.address;
  if (!shopDisplayName({ name: name ?? undefined, nickname: nickname ?? undefined })) return { status: 'invalid_shop' };
  if (!name && current.name) {
    const { rows } = await query(`
      SELECT 1 FROM cheapo.household_saved_shop WHERE shop_id = $1 AND household_id <> $2::uuid AND nickname IS NULL LIMIT 1
    `, [shopId, household]);
    if (rows.length) return { status: 'invalid_shop' };
  }
  if ('name' in details || 'address' in details) {
    await query(`UPDATE cheapo.shop SET name = $2, address = $3, record_version = record_version + 1 WHERE id = $1`,
      [shopId, name ?? null, address ?? null]);
  }
  if ('nickname' in details) {
    await query(`UPDATE cheapo.household_saved_shop SET nickname = $3, link_revision = gen_random_uuid()
      WHERE household_id = $1::uuid AND shop_id = $2`, [household, shopId, nickname ?? null]);
  }
  const after = await readSavedShop(query, household, shopId);
  if (!after) throw new Error('Could not read the saved shop revision.');
  await query(`
    INSERT INTO cheapo.saved_shop_revision
      (shop_id, household_id, actor_shopper_id, operation_id, operation_request, before_state, after_state)
    VALUES ($1, $2::uuid, $3::uuid, $4, $5::jsonb, $6::jsonb, $7::jsonb)
  `, [shopId, household, member.shopper_id, operation?.operationId ?? null, action, before, after]);
  return operation ? { status: 'detail', detail: after } : { status: 'ok', state: await readSavedShops(query, member) };
}

async function receiptedShopChange(
  query: ShoppingQuery, member: ShoppingMember, action: Extract<ShopAction, { kind: 'select' | 'unlink' }>,
): Promise<SavedShopResult | undefined> {
  const operationId = action.kind === 'select' ? action.operationId : action.operation?.operationId;
  if (!operationId) return undefined;
  const { shopId } = action;
  const operation = {
    kind: action.kind === 'select' ? 'shop_selection' as const : 'shop_unlink' as const,
    id: shopId, operationId, request: action,
  };
  const receipt = await readShoppingReceipt<{ shopId: string }>(query, member, operation);
  if (receipt) return receipt.matches ? { status: 'acknowledged', ...receipt.response } : { status: 'operation_conflict' };

  if (action.kind === 'unlink' && action.operation) {
    const current = await readSavedShop(query, member.household_id, shopId, true);
    if (current && current.version !== action.operation.expectedVersion) return { status: 'version_conflict', current };
  }
  const status = await changeShop(query, member, action);
  if (status !== 'ok') return { status };
  await saveShoppingReceipt(query, member, operation, { shopId });
  return { status: 'acknowledged', shopId };
}

export function postgresSavedShops(transaction: ShoppingTransaction): ExecuteSavedShop {
  return (digest, action) => transaction(async query => {
    // Hold the resolved household lock until links and selections commit together.
    const readOnly = action.kind === 'read' || action.kind === 'detail' || action.kind === 'candidates';
    const member = await readShoppingMember(query, digest, !readOnly);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };
    if (action.kind === 'read') {
      return { status: 'ok', state: await readSavedShops(query, member, action.includeVersions) };
    }
    if (action.kind === 'candidates') return { status: 'candidates', shops: await findShopCandidates(query, action.query) };
    if (action.kind === 'detail') {
      const detail = await readSavedShop(query, member.household_id, action.shopId);
      return detail ? { status: 'detail', detail } : { status: 'shop_not_saved' };
    }
    if (action.kind === 'edit') return editShop(query, member, action);
    if (action.kind === 'save' && action.operationId) {
      const operation = { kind: 'saved_shop' as const, id: action.shop.id, operationId: action.operationId, request: action };
      const receipt = await readShoppingReceipt<VersionedSavedShop>(query, member, operation);
      if (receipt) return receipt.matches ? { status: 'detail', detail: receipt.response } : { status: 'operation_conflict' };

      const status = await changeShop(query, member, action);
      if (status !== 'ok') return { status };
      const detail = await readSavedShop(query, member.household_id, action.shop.id);
      if (!detail) throw Error('Could not read the saved branch receipt.');
      await saveShoppingReceipt(query, member, operation, detail);
      return { status: 'detail', detail };
    }
    if (action.kind === 'select' || action.kind === 'unlink') {
      const receipted = await receiptedShopChange(query, member, action);
      if (receipted) return receipted;
    }
    const status = await changeShop(query, member, action);
    if (status !== 'ok') return { status };
    return { status: 'ok', state: await readSavedShops(query, member) };
  });
}
