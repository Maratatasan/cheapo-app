import { calculatePackUnitPrice, emptyReview, reviewComplete, reviewUnitPrice } from '@/data/photo-review';

const review = { ...emptyReview('Test shop'), productName: 'Rice', price: '2.50', packSize: '500 g' };

test('derives current pack price when the original unit fields are empty', () => {
  expect(reviewComplete(review)).toBe(true);
  expect(reviewUnitPrice(review)).toEqual({ amount: 5, unit: 'kg' });
  expect(reviewUnitPrice({ ...review, price: '3.00' })).toEqual({ amount: 6, unit: 'kg' });
  expect(reviewUnitPrice({ ...review, packSize: '1 litre' })).toEqual({ amount: 2.5, unit: 'litre' });
});

test('preserves supplied unit amount and basis and rejects partial or invalid entries', () => {
  expect(reviewUnitPrice({ ...review, unitPrice: '0.169', unit: '100g' })).toEqual({ amount: 0.169, unit: '100g' });
  expect(reviewUnitPrice({ ...review, unitPrice: '0.169' })).toBeNull();
  expect(reviewComplete({ ...review, packSize: '0 kg' })).toBe(false);
  expect(calculatePackUnitPrice('1.23', '2 boxes')).toBeNull();
  expect(reviewComplete({ ...review, packSize: undefined })).toBe(true);
});

test.each([
  ['8 × 500 mL', '3.20', 0.8, 'litre'],
  ['8x500 ml', '3.20', 0.8, 'litre'],
  ['3 X 0.5 kg', '6.00', 4, 'kg'],
])('calculates unit price for an explicit multipack (%s)', (packSize, price, amount, unit) => {
  const multipack = { ...review, packSize, price };
  expect(reviewComplete(multipack)).toBe(true);
  expect(reviewUnitPrice(multipack)).toEqual({ amount, unit });
  expect(reviewUnitPrice({ ...multipack, unitPrice: '0.75', unit })).toEqual({ amount: 0.75, unit });
});

test.each([
  '8 × 500',
  '8 × ml',
  '8 × 500 ml + 250 ml',
  '0 × 500 ml',
  '1.5 × 500 ml',
  '8 × 0 ml',
  '8 × 500 cans',
])('keeps an invalid or ambiguous pack in review (%s)', packSize => {
  const multipack = { ...review, packSize };
  expect(reviewComplete(multipack)).toBe(false);
  expect(reviewUnitPrice(multipack)).toBeNull();
});
