export type ShoppingQuery = <Row extends object>(text: string, params: unknown[]) => Promise<{ rows: Row[] }>;
export type ShoppingTransaction = <T>(execute: (query: ShoppingQuery) => Promise<T>) => Promise<T>;
export type ShoppingMember = { household_id: string; shopper_id: string; active: boolean };

export async function readShoppingMember(
  query: ShoppingQuery, digest: string, lockHousehold = false,
): Promise<ShoppingMember | undefined> {
  const { rows: [member] } = await query<ShoppingMember>(
    'SELECT household_id, shopper_id, active FROM cheapo.resolve_shopping_member($1, $2)',
    [digest, lockHousehold],
  );
  return member;
}
