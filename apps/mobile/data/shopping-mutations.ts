import { productSchema, shopSchema } from '@cheapo/domain';
import { canonicalProductBarcode } from '@cheapo/domain/product-barcode';
import { matchesReviewedUnitPrice, reviewedPrice, reviewedUnitPrice } from '@cheapo/domain/price-append';
import { z } from 'zod';

export const mutationOperationId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const id = z.string().regex(/^[^\s\p{Cc}]{1,128}$/u).refine(value => value !== '.' && value !== '..');
const groupId = z.string().trim().min(1).max(128).refine(value => !/[\p{Cc}/]/u.test(value));
const branchVersion = z.string().regex(/^[1-9][0-9]{0,9}:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const numberVersion = z.number().int().min(0).max(2_147_483_647);
const recordedVersion = numberVersion.min(1);
const earlierMutation = z.strictObject({ kind: z.literal('operation'), operationId: mutationOperationId });
const expectedNumber = z.union([z.strictObject({ kind: z.literal('version'), version: numberVersion }), earlierMutation]);
const expectedProduct = z.union([z.strictObject({ kind: z.literal('version'), version: recordedVersion }), earlierMutation]);
const expectedBranch = z.union([z.strictObject({ kind: z.literal('version'), version: branchVersion }), earlierMutation]);
const priceBase = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('version'), id: z.uuid(), version: recordedVersion }),
  z.strictObject({ kind: z.literal('append'), sourceId: mutationOperationId }),
  earlierMutation,
]);
const savedShop = shopSchema.refine(shop => id.safeParse(shop.id).success);
const catalogProduct = productSchema.omit({ photoIds: true })
  .refine(product => id.safeParse(product.id).success)
  .transform((product, context) => {
    if (!product.barcode) return product;
    const barcode = canonicalProductBarcode(product.barcode);
    if (barcode && product.productType) return { ...product, barcode };
    context.addIssue({ code: 'custom', path: ['barcode'], message: 'A valid barcode and product type are required.' });
    return z.NEVER;
  });
const shopDetails = z.strictObject({
  name: shopSchema.shape.name.nullable(),
  address: shopSchema.shape.address.nullable(),
  nickname: shopSchema.shape.nickname.nullable(),
}).refine(details => Object.values(details).some(value => value !== undefined));

const priceChange = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('correct'), review: reviewedPrice, unitPrice: reviewedUnitPrice.nullish(),
    productId: id.nullable().optional(),
    shop: z.strictObject({ id, displayName: z.string().trim().min(1).max(200).refine(value => !value.includes('\0')) }).optional(),
  }),
  z.strictObject({ action: z.literal('record_in_error'), reason: z.string().trim().min(1).max(300).refine(value => !value.includes('\0')) }),
  z.strictObject({ action: z.literal('undo_recorded_in_error') }),
]).refine(change => change.action !== 'correct' || matchesReviewedUnitPrice(change));

const action = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('save-shop'), shop: savedShop }),
  z.strictObject({ kind: z.literal('edit-shop'), shopId: id, details: shopDetails, base: expectedBranch }),
  z.strictObject({ kind: z.literal('unlink-shop'), shopId: id, base: expectedBranch }),
  z.strictObject({ kind: z.literal('select-shop'), shopId: id }),
  z.strictObject({ kind: z.literal('create-product'), product: catalogProduct }),
  z.strictObject({ kind: z.literal('edit-product'), product: catalogProduct, base: expectedProduct }),
  z.strictObject({ kind: z.literal('preference'), groupId,
    basis: z.enum(['kg', '100g', 'litre', '100mL', 'item', 'wash']).nullable(), base: expectedNumber }),
  z.strictObject({ kind: z.literal('price'), priceKey: id, base: priceBase, change: priceChange }),
]);

export const shoppingMutation = z.strictObject({
  operationId: mutationOperationId,
  createdAt: z.iso.datetime(),
  title: z.string().trim().min(1).max(128),
  action,
  waitFor: z.array(mutationOperationId).max(8).default([]),
}).refine(({ action }) => action.kind !== 'price' || action.base.kind !== 'append' || action.base.sourceId === action.priceKey);
export type ShoppingMutation = z.infer<typeof shoppingMutation>;
export type ShoppingMutationInput = z.input<typeof shoppingMutation>;
type MutationAction = ShoppingMutation['action'];

export type MutationRequest = { path: string; method: 'PUT' | 'PATCH' | 'DELETE'; body?: string };
export const mutationVersion = z.union([numberVersion, branchVersion]);
export const mutationReceipt = z.strictObject({
  id: id.optional(), version: mutationVersion.optional(),
});

export function mutationResource(action: MutationAction): string {
  switch (action.kind) {
    case 'save-shop': return `shop:${action.shop.id}`;
    case 'edit-shop':
    case 'unlink-shop': return `shop:${action.shopId}`;
    case 'select-shop': return 'current-shop';
    case 'create-product':
    case 'edit-product': return `product:${action.product.id}`;
    case 'preference': return `preference:${action.groupId}`;
    case 'price': return `price:${action.priceKey}`;
  }
}

export function requestForMutation(
  { operationId, action }: ShoppingMutation,
  predecessor?: z.infer<typeof mutationReceipt>,
): MutationRequest | undefined {
  const send = (path: string, method: MutationRequest['method'], body?: object): MutationRequest => ({
    path, method, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const shopPath = (shopId: string) => `/v1/me/saved-shops/${encodeURIComponent(shopId)}`;
  const productPath = (productId: string) => `/v1/products/${encodeURIComponent(productId)}`;
  const version = 'base' in action
    ? action.base.kind === 'version' ? action.base.version : predecessor?.version
    : undefined;

  switch (action.kind) {
    case 'save-shop': {
      const { id, ...details } = action.shop;
      return send(shopPath(id), 'PUT', { operationId, shop: details });
    }
    case 'unlink-shop':
      if (typeof version === 'string') return send(shopPath(action.shopId), 'DELETE', { operationId, expectedVersion: version });
      return;
    case 'select-shop': return send('/v1/me/current-shop', 'PUT', { operationId, shopId: action.shopId });
    case 'edit-shop':
      if (typeof version === 'string') return send(shopPath(action.shopId), 'PATCH',
        { operationId, expectedVersion: version, details: action.details });
      return;
    case 'create-product': {
      const { id, ...product } = action.product;
      return send(productPath(id), 'PUT', { operationId, product });
    }
    case 'edit-product': {
      const { id, ...product } = action.product;
      if (typeof version === 'number' && version > 0) {
        return send(productPath(id), 'PATCH', { operationId, expectedVersion: version, product });
      }
      return;
    }
    case 'preference':
      if (typeof version === 'number') return send(`/v1/me/comparison-preferences/${encodeURIComponent(action.groupId)}`,
        'PATCH', { operationId, expectedVersion: version, basis: action.basis });
      return;
    case 'price': {
      const resourceId = action.base.kind === 'version' ? action.base.id : predecessor?.id;
      if (typeof version === 'number' && version > 0 && z.uuid().safeParse(resourceId).success) {
        return send(`/v1/me/price-observations/${resourceId}`, 'PATCH',
          { operationId, expectedVersion: version, ...action.change });
      }
      return;
    }
  }
}

export function decodeMutationAcknowledgement(
  { action }: ShoppingMutation, request: MutationRequest, value: unknown,
): z.infer<typeof mutationReceipt> | undefined {
  switch (action.kind) {
    case 'create-product':
    case 'edit-product': {
      const reply = z.object({ product: z.object({ id }), version: recordedVersion }).safeParse(value);
      if (reply.success && reply.data.product.id === action.product.id) {
        return { id: reply.data.product.id, version: reply.data.version };
      }
      return;
    }
    case 'save-shop':
    case 'edit-shop': {
      const reply = z.object({ shop: z.object({ id }), version: branchVersion }).safeParse(value);
      const shopId = action.kind === 'save-shop' ? action.shop.id : action.shopId;
      if (reply.success && reply.data.shop.id === shopId) return { id: shopId, version: reply.data.version };
      return;
    }
    case 'select-shop':
    case 'unlink-shop': {
      const reply = z.object({ shopId: id }).safeParse(value);
      if (reply.success && reply.data.shopId === action.shopId) return { id: action.shopId };
      return;
    }
    case 'preference': {
      const reply = z.object({ basis: z.literal(action.basis), version: recordedVersion }).safeParse(value);
      if (reply.success) return { version: reply.data.version };
      return;
    }
    case 'price': {
      const reply = z.object({ observation: z.object({ id: z.uuid(), version: recordedVersion }) }).safeParse(value);
      if (reply.success && request.path === `/v1/me/price-observations/${reply.data.observation.id}`) {
        return reply.data.observation;
      }
      return;
    }
  }
}
