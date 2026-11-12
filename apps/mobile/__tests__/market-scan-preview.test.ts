import { scanUnitPrice } from '../stories/previews/market-scan-calculation';

test.each([
  ['2.50', '2 kg', 1.25, 'kg'],
  ['2.50', '2000g', 1.25, 'kg'],
  ['1.50', '500 mL', 3, 'litre'],
  ['1.50', '0.5 L', 3, 'litre'],
  ['6.00', '4 items', 1.5, 'item'],
  ['6.00', '4 item', 1.5, 'item'],
])('derives the comparison unit from %s per %s', (total, pack, amount, unit) => {
  expect(scanUnitPrice(total, pack)).toEqual({ amount, unit });
});

test.each([
  ['', '2 kg'], ['0', '2 kg'], ['2.50', '0 g'], ['2.50', 'kg'], ['2.50', '12 oz'], ['1.234', '1 kg'], ['Infinity', '1 kg'],
])('leaves unit price unset for invalid price or pack (%s, %s)', (total, pack) => {
  expect(scanUnitPrice(total, pack)).toBeNull();
});
