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
