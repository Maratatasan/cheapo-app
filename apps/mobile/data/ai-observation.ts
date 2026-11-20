import type { ObservationCardItem } from '@/component/results/observation-card';
import type { ProductMetadata } from './product-metadata';

export type PriceReadings = {
  product: string | null;
  packSize?: string | null;
  price: number | null;
  currency: string | null;
  unit_price: { amount:number; unit:string } | null;
} & { [Field in keyof ProductMetadata]?: string | null };
export type PriceAlternatives = { [Field in keyof PriceReadings]?: NonNullable<PriceReadings[Field]>[] };
export type AiPriceDraft = PriceReadings & { uncertainty: string; alternatives?: PriceAlternatives };

export const productIdentityFields = ['product', 'productType', 'variety', 'brand', 'packSize'] as const;
export type ProductIdentityField = typeof productIdentityFields[number];
export type ProductIdentityReadings = Record<ProductIdentityField, string | null>;
export type ProductIdentityDraft = ProductIdentityReadings & {
  uncertainty: string;
  alternatives?: Partial<Record<ProductIdentityField, string[]>>;
};
/** AI extraction supplies no shop, location or observation date. Never borrow samples. */
export function observationFromDraft(draft:AiPriceDraft):ObservationCardItem {
  return {
    product:draft.product || 'Product unconfirmed',price:draft.price,currency:draft.currency,
    unit_price:draft.unit_price ?? null,
    shop:'Shop unconfirmed',area:'Location unconfirmed',brand:draft.brand || 'Brand unconfirmed',pack:draft.packSize ?? 'Pack size unconfirmed',
    observedOn:null,distanceKm:null,condition:'Offer conditions unconfirmed',status:'Draft · review needed',
    note:draft.uncertainty || 'Review the photo details before using this draft.',
  };
}
