import type { PriceObservation } from '@cheapo/domain/price-history';

import type { LocalPhotoDraft, ManualPriceRecord } from '../data/local-photo';
import { emptyReview } from '../data/photo-review';
import { comparisonRowFromSavedHistory, savedPriceHistoryRows } from '../data/saved-price-history';

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
