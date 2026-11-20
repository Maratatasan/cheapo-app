import { checkProductIdentity } from '@/data/add-product-lookup';
import { emptyReview } from '@/data/photo-review';

const review = { ...emptyReview(), productName: ' Rolled oats ', brand: 'Market', packSize: ' 500 g ', productType: 'Oats' };
const product = { id: 'oats-market', name: 'Market Rolled Oats', barcode: '00036000291452', comparableGroupId: 'oats' };
const signal = new AbortController().signal;

test('an exact barcode match keeps the canonical product and skips possible-match search', async () => {
  const findByBarcode = jest.fn(async () => product);
  const findCandidates = jest.fn();
  await expect(checkProductIdentity({ findByBarcode, findCandidates }, review, '036000291452', signal)).resolves.toEqual({
    kind: 'checked', barcode: product.barcode, exact: true, candidates: [{ kind: 'catalog', product }], truncated: false,
  });
  expect(findByBarcode).toHaveBeenCalledWith(product.barcode, signal);
  expect(findCandidates).not.toHaveBeenCalled();
});

test('a checked barcode miss searches reviewed details and preserves a limited result', async () => {
  const findByBarcode = jest.fn(async () => undefined);
  const findCandidates = jest.fn(async () => ({ candidates: [], truncated: true }));
  await expect(checkProductIdentity({ findByBarcode, findCandidates }, review, product.barcode, signal)).resolves.toEqual({
    kind: 'checked', barcode: product.barcode, exact: false, candidates: [], truncated: true,
  });
  expect(findCandidates).toHaveBeenCalledWith({ name: 'Rolled oats', brand: 'Market', packSize: '500 g' }, signal);
});

test('an unavailable barcode read stays unavailable even if a name search would have returned no matches', async () => {
  const findByBarcode = jest.fn(async () => { throw Error('Offline'); });
  const findCandidates = jest.fn(async () => ({ candidates: [], truncated: false }));
  await expect(checkProductIdentity({ findByBarcode, findCandidates }, review, product.barcode, signal)).resolves.toEqual({
    kind: 'unavailable', barcode: product.barcode,
  });
  expect(findCandidates).not.toHaveBeenCalled();
});

test('rejects unreadable identity and ignores a result after the shopper cancels', async () => {
  const findByBarcode = jest.fn();
  const findCandidates = jest.fn();
  await expect(checkProductIdentity({ findByBarcode, findCandidates }, review, '0000', signal)).resolves.toMatchObject({ kind: 'invalid' });
  expect(findByBarcode).not.toHaveBeenCalled();

  const controller = new AbortController();
  const held = Promise.withResolvers<{ candidates: []; truncated: false }>();
  findCandidates.mockReturnValue(held.promise);
  const reading = checkProductIdentity({ findByBarcode, findCandidates }, review, '', controller.signal);
  controller.abort();
  held.resolve({ candidates: [], truncated: false });
  await expect(reading).rejects.toThrow('Cheapo request interrupted.');
});
