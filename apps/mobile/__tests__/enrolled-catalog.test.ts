import { createEnrolledCatalog } from '../data/enrolled-catalog';
import type { EditableProductRead, ShoppingRead } from '../data/cheapo-shopping-reads';
import type { QueuedShoppingMutation } from '../data/shopping-mutation-queue';
import { shoppingMutation, type ShoppingMutationInput } from '../data/shopping-mutations';

let mockNext = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `product-change-${++mockNext}` }));

const product = { id: 'oats', name: 'Oats', productType: 'Cereal', barcode: '00012345678905' };
const changedCode = '04006381333931';
const checked: ShoppingRead<EditableProductRead> = { status: 'cached', lastSyncedAt: '2026-11-20T01:00:00.000Z',
  value: { product, version: 2 } };

function fixture() {
  const entries: QueuedShoppingMutation[] = [];
  const args = {
    queue: {
      read: jest.fn(async () => ({ entries, recovery: [] })),
      enqueue: jest.fn(async (input: ShoppingMutationInput) => { entries.push({ intent: shoppingMutation.parse(input) }); }),
    },
    readByBarcode: jest.fn<Promise<ShoppingRead<EditableProductRead>>, [string, AbortSignal?]>(),
    readById: jest.fn<Promise<ShoppingRead<EditableProductRead>>, [string, AbortSignal?]>(),
    assertCurrent: jest.fn(async () => {}),
    sync: jest.fn(async () => {}),
  };
  return { args, entries, catalog: createEnrolledCatalog(args) };
}

test('requires a checked miss before showing an unknown barcode', async () => {
  const { args, catalog } = fixture();
  args.readByBarcode.mockResolvedValueOnce({ status: 'unavailable' });
  await expect(catalog.findByBarcode(product.barcode)).rejects.toThrow('offline');

  args.readByBarcode.mockResolvedValueOnce({ status: 'fresh', value: { product: null }, lastSyncedAt: checked.lastSyncedAt });
  await expect(catalog.findByBarcode(product.barcode)).resolves.toBeUndefined();
});

test('corrects a cached product against the displayed version without another lookup', async () => {
  const { args, catalog, entries } = fixture();
  args.readByBarcode.mockResolvedValue(checked);
  const displayed = await catalog.findByBarcode(product.barcode);
  if (!displayed) throw Error('Expected a checked product.');
  const corrected = await catalog.replaceBarcode(displayed, changedCode);
  expect(entries[0].intent.action).toMatchObject({ kind: 'edit-product', product: { ...product, barcode: changedCode },
    base: { kind: 'version', version: 2 } });
  expect(corrected.barcode).toBe(changedCode);
  expect(args.readByBarcode).toHaveBeenCalledTimes(1);
  await expect(catalog.findByBarcode(changedCode)).resolves.toMatchObject({ id: product.id, barcode: changedCode });
});

test('reopens an offline product then chains a correction to its committed creation', async () => {
  const { args, catalog, entries } = fixture();
  await catalog.save(product);
  const reopened = createEnrolledCatalog(args);
  await expect(reopened.save(product)).resolves.toMatchObject({ id: product.id });
  expect(entries).toHaveLength(1);
  const displayed = await reopened.findById(product.id);
  if (!displayed) throw Error('Expected the queued product.');
  await reopened.replaceBarcode(displayed, changedCode);
  expect(entries[1].intent.action).toMatchObject({
    kind: 'edit-product', base: { kind: 'operation', operationId: entries[0].intent.operationId },
  });
  expect(entries[1].intent.waitFor).toEqual([entries[0].intent.operationId]);

  args.assertCurrent.mockRejectedValue(Error('Cheapo access changed.'));
  await expect(reopened.save({ ...product, id: 'not-saved' })).rejects.toThrow('access changed');
  expect(entries).toHaveLength(2);
});

test('uses the chosen cloud product over older cache and keeps a later checked version', async () => {
  const { args, entries, catalog } = fixture();
  args.readByBarcode.mockResolvedValue(checked);
  const displayed = await catalog.findByBarcode(product.barcode);
  if (!displayed) throw Error('Expected a checked product.');
  await catalog.replaceBarcode(displayed, changedCode);
  entries[0].outcome = { kind: 'conflict', currentVersion: 4, current: { ...product, name: 'Cloud oats' } };
  entries[0].resolution = { kind: 'keep-cloud', laterIds: [] };
  const reopened = createEnrolledCatalog(args);
  const chosen = await reopened.findByBarcode(product.barcode);
  expect(chosen).toMatchObject({ name: 'Cloud oats', catalogBase: { kind: 'version', version: 4 } });
  args.readByBarcode.mockResolvedValueOnce({ ...checked, value: { product: { ...product, name: 'Newer oats' }, version: 5 } });
  await expect(reopened.findByBarcode(product.barcode)).resolves.toMatchObject({ name: 'Newer oats', catalogBase: { version: 5 } });
  if (!chosen) throw Error('Expected the chosen product.');
  await reopened.replaceBarcode(chosen, changedCode);
  expect(entries[1].intent.action).toMatchObject({ kind: 'edit-product', base: { kind: 'version', version: 4 } });
});
