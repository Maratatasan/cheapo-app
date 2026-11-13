import type { Shop } from '@cheapo/domain';

/** App view of the saved list and the shopper's current visit selection. */
export type SavedShopState = { shops: Shop[]; currentShop?: Shop };
export type ShopInput = Omit<Shop, 'id'> & { id?: string };
export type EditableShopDetails = Pick<Shop, 'nickname' | 'name' | 'address'>;

/** Mutations resolve with the saved list and selection after the change is committed. */
export interface ShopRepository {
  loadSavedShops(): Promise<SavedShopState>;
  saveShop(input: ShopInput, options?: { select?: boolean }): Promise<SavedShopState>;
  updateShop(id: string, details: EditableShopDetails): Promise<SavedShopState>;
  /** Select a saved shop for this shopper's current visit. */
  selectShop(id: string): Promise<SavedShopState>;
  /** Remove a shop from the saved list and clear its selection if selected. Keep historical snapshots. */
  removeShop(id: string): Promise<SavedShopState>;
}
