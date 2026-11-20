import { priceHistoryDetail } from '@cheapo/domain/price-history';
import { productSchema, type Product } from '@cheapo/domain';

import type { QueuedShoppingMutation } from './shopping-mutation-queue';

export type ConflictValues = { label: string; value: string }[];
export type ShoppingConflict = { title: string; phone: ConflictValues; cloud: ConflictValues; laterEdits: { id: string; title: string }[] };

type Field = [label: string, value: unknown];
const ready = 'Blank';
const unedited = 'Unchanged';

function fields(values: Field[], empty = ready): ConflictValues {
  return values.map(([label, value]) => ({ label, value: typeof value === 'string' && value.trim() ? value : value === null ? ready : empty }));
}

function object(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function amountUnit(amount: unknown, unit: unknown) {
  return (typeof amount === 'number' || typeof amount === 'string' && amount.trim())
    && typeof unit === 'string' && unit.trim() ? `${amount} / ${unit}` : undefined;
}

function productFields(product: Pick<Product, 'name' | 'productType' | 'variety' | 'brand' | 'barcode' | 'pack'>) {
  const { pack } = product;
  return fields([
    ['Product', product.name], ['Product type', product.productType],
    ['Brand', product.brand], ['Variety', product.variety],
    ['Barcode', product.barcode], ['Pack size', pack?.label ?? (pack && `${pack.quantity} ${pack.unit}`)],
  ]);
}

function priceFields(checked: Record<string, unknown>, extras?: {
  currency?: unknown; price?: unknown; productName?: unknown; shop?: unknown; unitPrice?: unknown;
}) {
  return fields([
    ['Product', checked.productName ?? extras?.productName], ['Pack size', checked.packSize],
    ['Price', checked.price ?? extras?.price], ['Currency', checked.currency ?? extras?.currency],
    ['Unit price', amountUnit(checked.unitPrice, checked.unit) ?? extras?.unitPrice],
    ['Product type', checked.productType], ['Brand', checked.brand], ['Variety', checked.variety],
    ['Shop', extras?.shop ?? unedited],
  ]);
}

export function shoppingConflictPreview(entry: QueuedShoppingMutation, laterEdits: ShoppingConflict['laterEdits']): ShoppingConflict | null {
  if (entry.outcome?.kind !== 'conflict' || entry.resolution || entry.superseded) return null;
  const { title, action } = entry.intent;
  const current = object(entry.outcome.current);
  if (action.kind === 'price') {
    const checked = priceHistoryDetail.safeParse({ observation: current });
    if (!checked.success) return null;
    const cloud = checked.data.observation;
    const review = object(cloud.review);
    const phone = action.change;
    const phoneFields = phone.action === 'correct'
      ? priceFields(phone.review, { shop: phone.shop?.displayName, unitPrice: phone.unitPrice && amountUnit(phone.unitPrice.amount, phone.unitPrice.unit) })
      : phone.action === 'record_in_error'
        ? fields([['Status', 'Recorded in error'], ['Reason', phone.reason]])
        : fields([['Status', 'Restore to comparisons']]);
    return { title, laterEdits, phone: phoneFields, cloud: [
      ...priceFields(review, { currency: cloud.currency, price: cloud.priceAmount, productName: cloud.productName,
        shop: cloud.shopDisplayName ?? ready, unitPrice: amountUnit(cloud.unitPrice?.amount, cloud.unitPrice?.unit) }),
      { label: 'Status', value: cloud.recordedInErrorReason ? 'Recorded in error' : 'Included in comparisons' },
      ...(cloud.recordedInErrorReason ? fields([['Reason', cloud.recordedInErrorReason]]) : []),
    ] };
  }
  if (action.kind === 'edit-product') {
    const cloud = productSchema.safeParse(current);
    return cloud.success ? { title, laterEdits, phone: productFields(action.product), cloud: productFields(cloud.data) } : null;
  }
  if (action.kind === 'edit-shop' || action.kind === 'unlink-shop') {
    return { title, laterEdits,
      phone: action.kind === 'unlink-shop' ? fields([['Saved shop', 'Remove from household']])
        : fields([['Shop name', action.details.name], ['Nickname', action.details.nickname], ['Address', action.details.address]], unedited),
      cloud: fields([['Shop name', current.name], ['Nickname', current.nickname], ['Address', current.address]]),
    };
  }
  if (action.kind === 'preference') {
    return { title, laterEdits, phone: [{ label: 'Compare by', value: action.basis ?? 'Automatic' }],
      cloud: [{ label: 'Compare by', value: typeof current.basis === 'string' ? current.basis : 'Automatic' }] };
  }
  return null;
}
