import { comparePrices, normalizedUnitPrice, type ComparisonPrice } from '@/data/comparison-prices';

const reference = {
  id: 'anchor', price: 2.25, currency: 'GBP', unit_price: { amount: 0.45, unit: '100 g' },
  productType: 'Dry rice', variety: 'Basmati', brand: 'Brand A',
};
const row = (id: string, fields: Partial<ComparisonPrice> = {}) => ({ ...reference, id, ...fields });
const offers = [
  reference,
  row('wrong form', { productType: 'Microwave rice' }),
  row('unknown type', { productType: undefined }),
  row('different currency', { currency: 'EUR' }),
  row('different dimension', { unit_price: { amount: 0.01, unit: 'ml' } }),
  row('same brand only', { variety: undefined, price: 20, unit_price: { amount: 0.2, unit: '100g' } }),
  row('same variety only', { brand: 'Brand B', price: 1, unit_price: { amount: 3, unit: 'kg' } }),
  row('both', { productType: '  DRY  rice ', variety: ' BASMATI ', brand: 'brand a', price: 10 }),
  row('missing price', { unit_price: null }),
  row('unknown unit', { unit_price: { amount: 0.01, unit: 'bag' } }),
];

test.each([
  [{ sameVariety: false, sameBrand: false }, ['same brand only', 'same variety only', 'both']],
  [{ sameVariety: true, sameBrand: false }, ['same variety only', 'both']],
  [{ sameVariety: false, sameBrand: true }, ['same brand only', 'both']],
  [{ sameVariety: true, sameBrand: true }, ['both']],
] as const)('filters by %j before ordering by normalized unit price', (filters, expected) => {
  const result = comparePrices(offers, reference, filters);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].entries.map(({ row }) => row.id)).toEqual(expected);
  expect(result.unranked.map(({ id }) => id)).toEqual(['missing price', 'unknown unit']);
});

test('explicitly reports missing reference metadata and a missing comparable reference unit', () => {
  const filters = { sameVariety: true, sameBrand: true };
  expect(comparePrices(offers, { ...reference, productType: '  ' }, filters).missing).toEqual(['product type']);
  expect(comparePrices(offers, { ...reference, variety: undefined, brand: '' }, filters).missing).toEqual(['variety', 'brand']);
  const withoutReferenceUnit = comparePrices([row('offer')], { ...reference, unit_price: null }, filters);
  expect(withoutReferenceUnit.groups).toEqual([]);
  expect(withoutReferenceUnit.unranked.map(({ id }) => id)).toEqual(['offer']);
});

test('converts only known price bases without crossing dimensions', () => {
  expect(normalizedUnitPrice({ amount: 4.12, unit: '100 g' })).toEqual({ amount: 41.2, unit: 'kg' });
  expect(normalizedUnitPrice({ amount: 0.25, unit: '100 ml' })).toEqual({ amount: 2.5, unit: 'litre' });
  expect(normalizedUnitPrice({ amount: 2.5, unit: 'L' })).toEqual({ amount: 2.5, unit: 'litre' });
  expect(normalizedUnitPrice({ amount: 1, unit: 'each' })).toEqual({ amount: 1, unit: 'item' });
  expect(normalizedUnitPrice({ amount: 1, unit: '0 g' })).toBeNull();
  expect(normalizedUnitPrice({ amount: 1, unit: 'bag' })).toBeNull();
});
