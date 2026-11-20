import type { Shop } from '@cheapo/domain';
import type { ShopCandidate } from './cheapo-shopping-reads';
import type { ShoppingMutation } from './shopping-mutations';

/** App view of the saved list and the shopper's current visit selection. */
export type ShopEditBase = Extract<ShoppingMutation['action'], { kind: 'edit-shop' }>['base'];
export type SavedShopSync = { status: 'fresh' | 'cached'; lastSyncedAt: string } | { status: 'unavailable' };
export type SavedShopState = {
  shops: Shop[];
  currentShop?: Shop;
  editBases?: ReadonlyMap<string, ShopEditBase>;
  sync?: SavedShopSync;
};
export type ShopInput = Omit<Shop, 'id'> & { id?: string };
export type EditableShopDetails = Pick<Shop, 'nickname' | 'name' | 'address'>;
export type ShopCandidateSearch = { status: 'checked' | 'unavailable' | 'needs-details'; shops: ShopCandidate[] };

/** Mutations resolve with the saved list and selection after the change is committed. */
export interface ShopRepository {
  loadSavedShops(): Promise<SavedShopState>;
  findShopCandidates?(details: Pick<EditableShopDetails, 'name' | 'address'>, signal?: AbortSignal): Promise<ShopCandidateSearch>;
  saveShop(input: ShopInput, options?: { select?: boolean }): Promise<SavedShopState>;
  updateShop(id: string, details: EditableShopDetails, base?: ShopEditBase): Promise<SavedShopState>;
  /** Select a saved shop for this shopper's current visit. */
  selectShop(id: string): Promise<SavedShopState>;
  /** Remove a shop from the saved list and clear its selection if selected. Keep historical snapshots. */
  removeShop(id: string, base?: ShopEditBase): Promise<SavedShopState>;
}
