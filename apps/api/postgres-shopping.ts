export type ShoppingQuery = <Row extends object>(text: string, params: unknown[]) => Promise<{ rows: Row[] }>;
export type ShoppingTransaction = <T>(execute: (query: ShoppingQuery) => Promise<T>) => Promise<T>;
export type ShoppingMember = { household_id: string; shopper_id: string; active: boolean };

export async function readShoppingMember(query: ShoppingQuery, digest: string): Promise<ShoppingMember | undefined> {
  const { rows: [member] } = await query<ShoppingMember>(`
    SELECT credential.household_id, credential.shopper_id, membership.revoked_at IS NULL AS active
    FROM cheapo.shopper_credential AS credential
    JOIN cheapo.household_membership AS membership USING (household_id, shopper_id)
    WHERE credential.token_digest = $1 AND credential.revoked_at IS NULL
      AND credential.expires_at > statement_timestamp()
    FOR SHARE OF credential, membership
  `, [digest]);
  return member;
}
