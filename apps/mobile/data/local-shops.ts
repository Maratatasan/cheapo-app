import type { Shop } from '@cheapo/domain';
import { shopDisplayName } from '@cheapo/domain/names';
import { randomUUID } from 'expo-crypto';

import { readShopSnapshot, writeShopSnapshot } from './shop-snapshot';

export type SavedShopState = {
  shops: Shop[];
  currentShop?: Shop;
};

type ShopInput = Omit<Shop, 'id'> & { id?: string };
type EditableShopDetails = Pick<Shop, 'nickname' | 'name' | 'address'>;
type ShopSnapshot = {
  version: 1;
  shops: Shop[];
  currentShopId?: string;
};

let pendingOperation: Promise<unknown> = Promise.resolve();

function getShopSchema(): typeof import('@cheapo/domain').shopSchema {
  // Keep Zod evaluation out of mobile startup when the local catalog is empty.
  return require('@cheapo/domain').shopSchema;
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingOperation.then(operation);
  pendingOperation = result.catch(() => {});
  return result;
}

async function loadSnapshot(): Promise<ShopSnapshot> {
  try {
    const raw = await readShopSnapshot();
    if (raw === null) return { version: 1, shops: [] };

    const snapshot: Partial<Record<keyof ShopSnapshot, unknown>> | null = JSON.parse(raw);
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.shops)
      || (snapshot.currentShopId !== undefined && typeof snapshot.currentShopId !== 'string')) {
      throw new Error('Invalid shop snapshot.');
    }

    const shops: Shop[] = [];
    if (snapshot.shops.length) {
      const shopSchema = getShopSchema();
      const ids = new Set<string>();
      for (const rawShop of snapshot.shops) {
        const shop = shopSchema.parse(rawShop);
        if (ids.has(shop.id)) throw new Error('Duplicate shop ID.');
        ids.add(shop.id);
        shops.push(shop);
      }
    }

    return { version: 1, shops, currentShopId: snapshot.currentShopId };
  } catch (cause) {
    throw new Error('Could not read saved shops. Try again.', { cause });
  }
}

function toState(snapshot: ShopSnapshot): SavedShopState {
  const currentShop = snapshot.shops.find((shop) => shop.id === snapshot.currentShopId);
  return currentShop ? { shops: snapshot.shops, currentShop } : { shops: snapshot.shops };
}

async function persist(snapshot: ShopSnapshot): Promise<SavedShopState> {
  try {
    await writeShopSnapshot(JSON.stringify(snapshot));
    return toState(snapshot);
  } catch (cause) {
    throw new Error('Could not save your shop changes. Try again.', { cause });
  }
}

export function loadSavedShops(): Promise<SavedShopState> {
  return serialize(async () => toState(await loadSnapshot()));
}

function validateShop(input: Shop): Shop {
  if (!shopDisplayName(input)) throw new Error('Enter a shop nickname or name.');
  const result = getShopSchema().safeParse(input);
  if (!result.success) throw new Error('Check the shop details and try again.', { cause: result.error });
  return result.data;
}

export function saveShop(input: ShopInput, options?: { select?: boolean }): Promise<SavedShopState> {
  return serialize(async () => {
    const shop = validateShop({ ...input, id: input.id ?? randomUUID() });
    const snapshot = await loadSnapshot();
    const index = snapshot.shops.findIndex(({ id }) => id === shop.id);
    if (index < 0) snapshot.shops.push(shop);
    else snapshot.shops[index] = shop;
    if (options?.select) snapshot.currentShopId = shop.id;
    return persist(snapshot);
  });
}

export function updateShop(id: string, { nickname, name, address }: EditableShopDetails): Promise<SavedShopState> {
  return serialize(async () => {
    const snapshot = await loadSnapshot();
    const index = snapshot.shops.findIndex(shop => shop.id === id);
    if (index < 0) throw new Error('That shop is no longer saved.');
    snapshot.shops[index] = validateShop({ ...snapshot.shops[index], nickname, name, address });
    return persist(snapshot);
  });
}

export function removeShop(id: string): Promise<SavedShopState> {
  return serialize(async () => {
    const snapshot = await loadSnapshot();
    const shops = snapshot.shops.filter(shop => shop.id !== id);
    if (shops.length === snapshot.shops.length) throw new Error('That shop is no longer saved.');
    const currentShopId = snapshot.currentShopId === id ? undefined : snapshot.currentShopId;
    return persist({ ...snapshot, shops, currentShopId });
  });
}

export function selectShop(id: string): Promise<SavedShopState> {
  return serialize(async () => {
    const snapshot = await loadSnapshot();
    if (!snapshot.shops.some((shop) => shop.id === id)) {
      throw new Error('That shop is no longer saved. Choose a saved shop.');
    }
    if (snapshot.currentShopId === id) return toState(snapshot);
    return persist({ ...snapshot, currentShopId: id });
  });
}
