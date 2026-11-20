import type { ShoppingMember, ShoppingQuery } from './postgres-shopping.ts';

type ShoppingOperation = {
  kind: 'product' | 'saved_shop' | 'shop_unlink' | 'shop_selection';
  id: string;
  operationId: string;
  request: object;
};

function receiptValues(member: ShoppingMember, operation: ShoppingOperation) {
  return [member.household_id, member.shopper_id, operation.operationId, operation.kind, operation.id, operation.request];
}

export async function readShoppingReceipt<Result extends object>(
  query: ShoppingQuery, member: ShoppingMember, operation: ShoppingOperation,
) {
  const { rows: [receipt] } = await query<{ matches: boolean; response: Result }>(`
    SELECT resource_kind = $4 AND resource_id = $5 AND operation_request = $6::jsonb AS matches, response
    FROM cheapo.shopping_operation_receipt
    WHERE household_id = $1::uuid AND actor_shopper_id = $2::uuid AND operation_id = $3
  `, receiptValues(member, operation));
  return receipt;
}

export async function saveShoppingReceipt(
  query: ShoppingQuery, member: ShoppingMember, operation: ShoppingOperation, response: object,
) {
  await query(`
    INSERT INTO cheapo.shopping_operation_receipt
      (household_id, actor_shopper_id, operation_id, resource_kind, resource_id, operation_request, response)
    VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::jsonb)
  `, [...receiptValues(member, operation), response]);
}
