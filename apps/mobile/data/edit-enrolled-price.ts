import type { PriceObservationDetail } from '@cheapo/domain/price-history';
import { randomUUID } from 'expo-crypto';

import type { SavedPriceRecord } from './local-photo';
import { emptyReview, reviewUnitPrice, type ManualReview } from './photo-review';
import type { ShoppingMutation } from './shopping-mutations';
import { priceChangeIsNewerThan } from './shopping-pending-price-changes';
import type { CheapoShoppingRuntime } from './shopping-sync-runtime';

type PriceAction = Extract<ShoppingMutation['action'], { kind: 'price' }>;
export type PriceEditTarget = { priceKey: string; base: PriceAction['base'] };
export type PriceEditRecord = Pick<SavedPriceRecord, 'id' | 'capturedAt' | 'review' | 'productId' | 'shop' | 'original' | 'selected'>;

function reviewFromObservation(observation: PriceObservationDetail): ManualReview {
  const stored = observation.review;
  const text = (field: string) => typeof stored?.[field] === 'string' ? stored[field] : undefined;
  const price = observation.priceAmount ?? '';
  // PostgreSQL can return a decimal padded with trailing zeros.
  const packPrice = price.includes('.') ? price.replace(/0+$/, '').replace(/\.$/, '') : price;
  return {
    ...emptyReview(observation.shopDisplayName ?? ''), productName: text('productName') ?? observation.productName ?? '',
    price: text('price') ?? packPrice, currency: observation.currency ?? 'GBP',
    brand: text('brand'), variety: text('variety'), productType: text('productType'), packSize: text('packSize'),
    unitPrice: text('unitPrice') ?? '', unit: text('unit') ?? '',
  };
}

export async function readEnrolledPriceEdit(
  runtime: CheapoShoppingRuntime,
  record: PriceEditRecord,
  observation?: PriceObservationDetail,
) {
  const [{ entries }, changes] = await Promise.all([runtime.priceQueue.read(), runtime.loadPriceChanges()]);
  const localId = observation ? observation.ownedByCurrentShopper ? observation.sourceId : undefined : record.id;
  const queued = entries.find(entry => entry.record.id === localId
    && (!observation || !entry.receipt || entry.receipt.id === observation.id));
  const resourceId = observation?.id ?? queued?.receipt?.id;
  const observedVersion = observation?.version ?? queued?.receipt?.version;
  let base: PriceAction['base'] | undefined = resourceId && observedVersion
    ? { kind: 'version', id: resourceId, version: observedVersion }
    : queued ? { kind: 'append', sourceId: queued.record.id } : undefined;
  let review = record.review;
  let productId = record.productId;
  let shop = record.shop;
  let errorReason = observation?.recordedInErrorReason;
  for (const candidate of changes) {
    const matches = candidate.resourceId ? candidate.resourceId === resourceId
      : localId !== undefined && candidate.sourceId === localId;
    if (!matches || !priceChangeIsNewerThan(candidate, observedVersion)) continue;
    const { change } = candidate;
    if (change.action === 'keep_cloud') {
      const cloud = change.observation;
      const chosen = recordFromObservation(cloud);
      review = chosen.review;
      productId = chosen.productId;
      shop = chosen.shop;
      errorReason = cloud.recordedInErrorReason;
      base = { kind: 'version', id: cloud.id, version: cloud.version };
      continue;
    }
    if (candidate.state !== 'recovery') base = { kind: 'operation', operationId: candidate.operationId };
    if (change.action === 'record_in_error') errorReason = change.reason;
    if (change.action === 'undo_recorded_in_error') errorReason = undefined;
    if (change.action === 'correct') {
      review = { ...emptyReview(change.shop?.displayName ?? review?.shop), ...change.review };
      if (change.productId !== undefined) productId = change.productId ?? undefined;
      if (change.shop) shop = change.shop;
    }
  }
  // Match the same resource key whether Edit opened from the phone or a shared record.
  const priceKey = queued?.record.id ?? resourceId;
  return {
    record: { ...record, review, productId, shop },
    target: base && priceKey ? { priceKey, base } : undefined,
    errorReason,
  };
}

export function recordFromObservation(observation: PriceObservationDetail): PriceEditRecord {
  const review = reviewFromObservation(observation);
  return {
    id: observation.id, capturedAt: observation.capturedAt, review, productId: observation.productId ?? undefined,
    shop: observation.shopId && observation.shopDisplayName
      ? { id: observation.shopId, displayName: observation.shopDisplayName } : undefined,
  };
}

export function correctionFromReview(review: ManualReview): PriceAction['change'] {
  const { shop: _displayName, ...fields } = review;
  return { action: 'correct', review: fields, unitPrice: reviewUnitPrice(review) };
}

export async function saveEnrolledPriceEdit(
  runtime: CheapoShoppingRuntime, target: PriceEditTarget, title: string, change: PriceAction['change'],
) {
  await runtime.commitMutation({
    operationId: randomUUID(), createdAt: new Date().toISOString(), title: title.trim().slice(0, 128),
    action: { kind: 'price', ...target, change },
  });
  void runtime.retry().catch(() => { /* The durable change stays visible in Pending sync. */ });
}
