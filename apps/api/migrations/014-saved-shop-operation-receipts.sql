BEGIN;

ALTER TABLE cheapo.shopping_create_receipt RENAME TO shopping_operation_receipt;
ALTER TABLE cheapo.shopping_operation_receipt
  DROP CONSTRAINT shopping_create_receipt_resource_kind_check,
  ADD CONSTRAINT shopping_operation_receipt_resource_kind_check
    CHECK (resource_kind IN ('product', 'saved_shop', 'shop_unlink', 'shop_selection'));

COMMIT;
