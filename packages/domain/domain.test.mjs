import assert from 'node:assert/strict';
import test from 'node:test';

import { productSchema, shopDisplayName, shopSchema } from '@cheapo/domain';
import { normalizeName } from '@cheapo/domain/names';

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

test('validates and serializes exact products in the same comparable group', () => {
  const product = {
    id: 'basmati-brand-a-500g',
    name: 'Dry basmati rice',
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
