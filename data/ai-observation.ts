import type { ObservationCardItem } from '@/component/results/observation-card';
export type AiPriceDraft = {
  product: string | null;
  price: number | null;
  currency: string | null;
  unit_price: { amount:number; unit:string } | null;
  uncertainty: string;
};
/** AI extraction supplies no shop, location or observation date. Never borrow samples. */
export function observationFromDraft(draft:AiPriceDraft):ObservationCardItem {
  return {
    product:draft.product || 'Product unconfirmed',price:draft.price,currency:draft.currency,
    unit_price:draft.unit_price ?? null,
    shop:'Shop unconfirmed',area:'Location unconfirmed',brand:'Brand unconfirmed',pack:'Pack size unconfirmed',
    observedOn:null,distanceKm:null,condition:'Offer conditions unconfirmed',status:'Draft · review needed',
    note:draft.uncertainty || 'Review the photo details before using this draft.',
  };
}
