import assert from 'node:assert/strict';
import test from 'node:test';

import { derivePackageUnitPrices, productSchema, shopDisplayName, shopSchema } from '@cheapo/domain';
import { normalizeName, shopDisplayName as lightweightShopDisplayName } from '@cheapo/domain/names';

const manualShop = { id: 'shop-123', name: 'Tesco Borough Road' };

test('shop and product names trim surrounding whitespace and reject blanks', () => {
  assert.equal(normalizeName('  Dry basmati rice  '), 'Dry basmati rice');
  assert.equal(normalizeName('  '), undefined);
  assert.equal(shopSchema.parse({ ...manualShop, name: ' Tesco Borough Road ' }).name, 'Tesco Borough Road');
  assert.equal(productSchema.parse({ id: 'rice-1', name: ' Dry basmati rice ' }).name, 'Dry basmati rice');
  assert.equal(shopSchema.safeParse({ ...manualShop, name: ' ' }).success, false);
});

test('a manual shop needs no coordinates and prefers a trimmed nickname', () => {
  const shop = shopSchema.parse({ ...manualShop, nickname: '  My Tesco  ' });
  assert.equal(shopDisplayName(shop), 'My Tesco');
  assert.equal(shop.id, 'shop-123');
  assert.equal(shop.location, undefined);
  assert.equal(shopDisplayName(shopSchema.parse(manualShop)), 'Tesco Borough Road');
  assert.equal(shopDisplayName(shopSchema.parse({ ...manualShop, nickname: '  ' })), 'Tesco Borough Road');
});

test('a shop can use a nickname without a branch name', () => {
  const shop = shopSchema.parse({ id: 'lidl-tandem', nickname: ' Tandem Centre Lidl ', name: '  ' });

  assert.equal(shop.id, 'lidl-tandem');
  assert.equal(shop.name, undefined);
  assert.equal(shopDisplayName(shop), 'Tandem Centre Lidl');
  assert.equal(shopSchema.safeParse({ id: 'lidl-tandem', nickname: 'Tandem Centre Lidl' }).success, true);
});

test('a shop needs a stable ID and at least one nonblank name', () => {
  for (const shop of [
    { id: 'shop-123' },
    { id: 'shop-123', name: '  ', nickname: '\t' },
    { id: 'shop-123', name: 'Shop', nickname: 123 },
    { name: 'Shop' },
    { id: '  ', nickname: 'Shop' },
  ]) {
    assert.equal(shopSchema.safeParse(shop).success, false);
  }
});

test('the lightweight display helper also works with unvalidated form text', () => {
  assert.equal(lightweightShopDisplayName({ nickname: ' My Tesco ', name: ' Tesco ' }), 'My Tesco');
  assert.equal(lightweightShopDisplayName({ nickname: ' ', name: ' Tesco ' }), 'Tesco');
  assert.equal(lightweightShopDisplayName({ nickname: ' ', name: ' ' }), undefined);
});

test('validates and serializes exact products in the same comparable group', () => {
  const product = {
    id: 'basmati-brand-a-500g',
    name: 'Dry basmati rice',
    productType: 'Dry rice',
    variety: 'Basmati',
    brand: 'Brand A',
    barcode: '0012345678905',
    pack: { quantity: 500, unit: 'g' },
    photoIds: ['photo-789'],
    comparableGroupId: 'dry-basmati-rice',
  };
  const first = productSchema.parse(product);
  const second = productSchema.parse({
    id: 'basmati-brand-b-1kg',
    name: 'Dry basmati rice',
    brand: 'Brand B',
    pack: { quantity: 1, unit: 'kg' },
    comparableGroupId: 'dry-basmati-rice',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(first)), product);
  assert.equal(second.comparableGroupId, first.comparableGroupId);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.pack, { quantity: 1, unit: 'kg' });
});

test('shop coordinates must be a complete pair of finite values in range', () => {
  assert.deepEqual(shopSchema.parse({
    ...manualShop,
    address: '1 Borough Road',
    location: { latitude: -90, longitude: 180 },
  }).location, { latitude: -90, longitude: 180 });

  for (const location of [
    {},
    { latitude: 51.4 },
    { longitude: -0.17 },
    { latitude: -90.01, longitude: 0 },
    { latitude: 0, longitude: 180.01 },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    { latitude: Number.NaN, longitude: 0 },
    { latitude: '51.4', longitude: 0 },
    null,
  ]) {
    assert.equal(shopSchema.safeParse({ ...manualShop, location }).success, false);
  }
});

test('a product can omit details and drops observation fields on parse', () => {
  const product = { id: 'milk-1', name: 'Milk' };
  assert.deepEqual(productSchema.parse({
    ...product,
    price: 1.50,
    promotion: 'Loyalty price',
    observedOn: '2026-11-10',
  }), product);
});

test('rejects malformed product details without coercing them', () => {
  const product = { id: 'milk-1', name: 'Milk' };
  for (const details of [
    { id: '' },
    { name: '  ' },
    { productType: ' ' },
    { variety: 123 },
    { barcode: 123 },
    { barcode: '12A3' },
    { pack: { quantity: 2 } },
    { pack: { quantity: 0, unit: 'kg' } },
    { pack: { quantity: -1, unit: 'kg' } },
    { pack: { quantity: Number.POSITIVE_INFINITY, unit: 'kg' } },
    { pack: { quantity: 1, unit: ' ' } },
    { pack: { quantity: '1', unit: 'kg' } },
    { photoIds: [{ bytes: 'image data' }] },
    { comparableGroupId: ' ' },
  ]) {
    assert.equal(productSchema.safeParse({ ...product, ...details }).success, false);
  }
});

test('derives independent prices per weight and per tomato from the reviewed pack', () => {
  const measures = {
    mass: { total: { quantity: 500, unit: 'g' } },
    itemCount: 6,
  };

  assert.deepEqual(derivePackageUnitPrices({ amount: 3, currency: 'GBP' }, measures), {
    kg: { amount: 6, currency: 'GBP' },
    '100g': { amount: 0.6, currency: 'GBP' },
    item: { amount: 0.5, currency: 'GBP' },
  });
});

test('derives independent prices per volume and per manufacturer-stated wash', () => {
  const measures = {
    volume: { total: { quantity: 3510, unit: 'mL' } },
    statedWashCount: { quantity: 130, source: 'manufacturer' },
  };

  const rates = derivePackageUnitPrices({ amount: 7.02, currency: 'GBP' }, measures);

  assert.deepEqual(Object.keys(rates).sort(), ['100mL', 'litre', 'wash']);
  assert.equal(rates.litre.currency, 'GBP');
  assert.ok(Math.abs(rates.litre.amount - 2) < 1e-12);
  assert.ok(Math.abs(rates['100mL'].amount - 0.2) < 1e-12);
  assert.equal(rates.wash.amount, 0.054);
  assert.equal(measures.volume.total.unit, 'mL');
});

test('leaves missing totals and counts unknown', () => {
  const price = { amount: 6.5, currency: 'GBP' };
  const washOnly = derivePackageUnitPrices(price, {
    volume: { perPack: { quantity: 3510, unit: 'mL' } },
    statedWashCount: { quantity: 130, source: 'manufacturer' },
  });

  assert.deepEqual(washOnly, { wash: { amount: 0.05, currency: 'GBP' } });
  assert.deepEqual(derivePackageUnitPrices(price, { packCount: 4 }), {});
});

test('uses confirmed multipack facts without assuming the number of items inside', () => {
  const price = { amount: 5, currency: 'EUR' };
  const measures = {
    packCount: 4,
    mass: { perPack: { quantity: 500, unit: 'g' }, total: { quantity: 2, unit: 'kg' } },
    volume: { perPack: { quantity: 250, unit: 'mL' } },
  };

  assert.deepEqual(derivePackageUnitPrices(price, measures), {
    kg: { amount: 2.5, currency: 'EUR' },
    '100g': { amount: 0.25, currency: 'EUR' },
    litre: { amount: 5, currency: 'EUR' },
    '100mL': { amount: 0.5, currency: 'EUR' },
  });
});

test('leaves contradictory mass unranked while retaining the independent item price', () => {
  const measures = {
    packCount: 4,
    mass: { perPack: { quantity: 500, unit: 'g' }, total: { quantity: 1.5, unit: 'kg' } },
    itemCount: 4,
  };

  assert.deepEqual(derivePackageUnitPrices({ amount: 5, currency: 'GBP' }, measures), {
    item: { amount: 1.25, currency: 'GBP' },
  });
});

test('skips invalid measures and unsupported provenance', () => {
  const price = { amount: 5, currency: 'GBP' };
  const measures = {
    packCount: 1.5,
    mass: { perPack: { quantity: 400, unit: 'g' }, total: { quantity: 0, unit: 'kg' } },
    volume: { total: { quantity: Infinity, unit: 'L' } },
    itemCount: Number.MAX_SAFE_INTEGER + 1,
    statedWashCount: { quantity: 130, source: 'estimated' },
  };

  assert.deepEqual(derivePackageUnitPrices(price, measures), {});
  assert.deepEqual(derivePackageUnitPrices(price, { mass: { total: { quantity: 1, unit: 'L' } } }), {});
});

test('omits all package rates when the pack price or currency is unavailable', () => {
  const measures = { mass: { total: { quantity: 500, unit: 'g' } } };

  for (const amount of [0, -1, NaN, Infinity]) {
    assert.deepEqual(derivePackageUnitPrices({ amount, currency: 'GBP' }, measures), {});
  }
  assert.deepEqual(derivePackageUnitPrices({ amount: 2, currency: '' }, measures), {});
});
