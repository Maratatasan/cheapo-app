import type { PriceObservation } from '@cheapo/domain/price-history';

import type { LocalPhotoDraft, ManualPriceRecord } from '../data/local-photo';
import { emptyReview } from '../data/photo-review';
import { comparePrices } from '../data/comparison-prices';
import { comparisonRowFromSavedHistory, projectSharedPrice, savedPriceHistoryRows, type PendingHistoryChange } from '../data/saved-price-history';

const capturedAt = '2026-01-02T09:30:00.123456Z';
const market = { id: 'market', displayName: 'Example Market' };
const review = { ...emptyReview(market.displayName), productName: 'Oats', productType: 'Oats', price: '3.19' };
const primaryId = 'fa91641f-d265-4a3b-9695-4ff553ab5138';
const peerId = '5353588d-923b-4f09-903d-f72adeaded5a';
const otherId = '9305cd46-c24f-41f8-a8f4-35986aad2737';

function local(id: string): ManualPriceRecord {
  return { id, productId: 'oats', capturedAt, review, shop: market };
}

function observation(id: string, sourceId: string, ownedByCurrentShopper: boolean): PriceObservation {
  return {
    id, sourceId, ownedByCurrentShopper, capturedAt, version: 1, productId: 'oats', sourceProductId: null,
    productName: 'Oats', shopId: 'market', sourceShopId: null, shopDisplayName: market.displayName,
    priceAmount: '3.1900', currency: 'GBP', review: { productType: 'Oats', packSize: '500 g' },
    unitPrice: { amount: 0.638, unit: '100g' }, photos: [],
  };
}

test('uses the exact acknowledgement and keeps another shopper’s coincidental source ID separate', () => {
  const offline = local('same-source');
  const peer = observation(peerId, offline.id, false);
  const mine = observation(primaryId, offline.id, true);
  const receipt = { sourceId: offline.id, id: mine.id, version: 1 };
  const display = savedPriceHistoryRows({ legacy: [], queued: [{ record: offline, receipt }], shared: [peer, mine] });
  expect(display).toEqual([
    { source: 'shared', key: `shared:${peer.id}`, observation: peer },
    { source: 'shared', key: `shared:${mine.id}`, observation: mine,
      linkedLocal: { source: 'queued', key: `queued:${offline.id}`, record: offline, receipt } },
  ]);

  const peerOnly = savedPriceHistoryRows({ legacy: [], queued: [{ record: offline, receipt }], shared: [peer] });
  expect(peerOnly).toMatchObject([
    { source: 'shared', key: `shared:${peer.id}` },
    { source: 'queued', key: `queued:${offline.id}`, record: offline, receipt },
  ]);
});

test('uses only server-owned sources for a lost receipt or restored local row', () => {
  const legacy = local('restored');
  const pending = local('lost-reply');
  const remoteLegacy = observation(primaryId, legacy.id, true);
  const remotePending = observation(peerId, pending.id, true);
  const peer = observation(otherId, legacy.id, false);
  const display = savedPriceHistoryRows({ legacy: [legacy], queued: [{ record: pending }], shared: [remoteLegacy, remotePending, peer] });
  expect(display).toMatchObject([
    { source: 'shared', observation: remoteLegacy, linkedLocal: { source: 'legacy', record: legacy } },
    { source: 'shared', observation: remotePending, linkedLocal: { source: 'queued', record: pending } },
    { source: 'shared', observation: peer },
  ]);
  expect(display[2]).not.toHaveProperty('linkedLocal');
  expect(savedPriceHistoryRows({ legacy: [legacy], queued: [], shared: [peer] })).toMatchObject([
    { source: 'shared', observation: peer }, { source: 'legacy', record: legacy },
  ]);
});

test('keeps an unmatched exact receipt and an unfinished local draft readable', () => {
  const queued = local('pending');
  const receipt = { id: primaryId, sourceId: queued.id, version: 1 };
  const photo = { uri: 'file:///documents/draft.jpg', mimeType: 'image/jpeg' as const, width: 400, height: 300 };
  const draft: LocalPhotoDraft = { id: 'draft', capturedAt, original: photo, selected: photo };
  const display = savedPriceHistoryRows({
    legacy: [draft], queued: [{ record: queued, receipt }],
    shared: [observation(peerId, queued.id, true), observation(otherId, draft.id, true)],
  });
  expect(display.map(row => row.key)).toEqual([`shared:${peerId}`, `shared:${otherId}`, 'queued:pending', 'legacy:draft']);
  expect(display[3]).toMatchObject({ source: 'legacy', record: draft });
  expect(comparisonRowFromSavedHistory(display[3])).toBeNull();
});

test('keeps the latest shared version across pages and excludes recorded errors from comparisons', () => {
  const initial = observation(primaryId, 'price', true);
  const revised = { ...initial, version: 2, recordedInErrorReason: 'Wrong pack' };
  const peer = observation(peerId, 'another', false);
  const display = savedPriceHistoryRows({ legacy: [], queued: [], shared: [initial, peer, revised] });
  expect(display).toHaveLength(2);
  expect(display[0]).toMatchObject({ source: 'shared', observation: revised });
  expect(comparisonRowFromSavedHistory(display[0])).toBeNull();
  expect(comparisonRowFromSavedHistory(display[1])).toMatchObject({
    id: `shared:${peer.id}`, capturedOn: '2026-01-02', productType: 'Oats', pack: '500 g',
    price: 3.19, currency: 'GBP', unit_price: { amount: 0.638, unit: '100g' },
  });
});

test('compares projected prices by compatible units and independent brand and variety filters', () => {
  const reference = { ...observation(primaryId, 'ours', true), version: 3,
    review: { productType: 'Oats', brand: 'Example', variety: 'Rolled' }, unitPrice: { amount: 3, unit: 'kg' } };
  const peer = { ...observation(peerId, 'ours', false), review: { productType: 'Oats', brand: 'Peer', variety: 'Rolled' },
    unitPrice: { amount: 0.10, unit: '100g' } };
  const unrankable = { ...observation(otherId, 'unrankable', false), unitPrice: null };
  const hidden = { ...observation('771f4baa-b8ec-442c-8592-ed74b6c8acbb', 'wrong', false), recordedInErrorReason: 'Wrong pack' };
  const waiting = { ...local('queued'), review: { ...review, brand: 'Example', variety: 'Steel-cut', unitPrice: '2', unit: 'kg' } };
  const changes: PendingHistoryChange[] = [
    { resourceId: reference.id, state: 'waiting', change: { action: 'correct',
      review: { productName: 'Corrected oats', productType: 'Oats', brand: 'Example', variety: 'Rolled', price: '3.20', currency: 'GBP' },
      unitPrice: { amount: 3.2, unit: 'kg' } } },
    { sourceId: waiting.id, state: 'waiting', change: { action: 'correct',
      review: { productName: 'Corrected queued oats', productType: 'Oats', brand: 'Example', variety: 'Steel-cut',
        price: '1.50', currency: 'GBP', unitPrice: '1.5', unit: 'kg' }, unitPrice: { amount: 1.5, unit: 'kg' } } },
  ];
  const projected = projectSharedPrice(reference, changes);
  expect(projected.display).toMatchObject({ version: 3, priceAmount: '3.20' });
  expect(reference.priceAmount).toBe('3.1900');
  const rows = savedPriceHistoryRows({ legacy: [], queued: [{ record: waiting }], shared: [reference, peer, unrankable, hidden] });
  const comparisons = rows.flatMap(row => comparisonRowFromSavedHistory(row, changes) ?? []);
  const selected = comparisons.find(row => row.id === `shared:${reference.id}`);
  expect(selected?.price).toBe(3.2);
  expect(comparisons.some(row => row.id === `shared:${hidden.id}`)).toBe(false);
  const ranked = comparePrices(comparisons, selected);
  expect(ranked.groups[0].entries.map(({ row }) => row.id)).toEqual([`shared:${peer.id}`, 'queued:queued']);
  expect(ranked.unranked.map(row => [row.id, row.unit_price])).toEqual([[`shared:${unrankable.id}`, null]]);
  expect(comparePrices(comparisons, selected, { sameBrand: true, sameVariety: false }).groups[0].entries[0].row.id).toBe('queued:queued');
  expect(comparePrices(comparisons, selected, { sameBrand: false, sameVariety: true }).groups[0].entries[0].row.id).toBe(`shared:${peer.id}`);
});
