import { openShoppingMutationQueue } from '../data/shopping-mutation-queue';
import type { ShoppingMutationInput } from '../data/shopping-mutations';

const mockFiles = new Map<string, string>();
let mockSequence = 0;
let mockFailMove = false;

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => require('node:crypto').createHash('sha256').update(value).digest('hex'),
  randomUUID: () => `staging-${++mockSequence}`,
}));

jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = (typeof parent === 'string' ? parent : parent.uri) + (name ? '/' + name : '');
    }
    get name() { return this.uri.split('/').at(-1); }
    get exists() { return mockFiles.has(this.uri); }
    async text() { return mockFiles.get(this.uri); }
    async write(value: string) { mockFiles.set(this.uri, value); }
    async move(target: File) {
      if (mockFailMove || target.exists) throw Error('Interrupted publication.');
      mockFiles.set(target.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(parent: string | Directory, name: string) {
      this.uri = (typeof parent === 'string' ? parent : parent.uri) + '/' + name;
    }
    create() {}
    get exists() { return [...mockFiles.keys()].some(key => key.startsWith(this.uri + '/')); }
    list() { return [...mockFiles.keys()].filter(key => key.startsWith(this.uri + '/')).map(key => new File(key)); }
  }
  return { Directory, File, Paths: { document: 'file:///documents', cache: 'file:///cache' } };
});

const owner = {
  origin: 'https://shopping.example',
  householdId: '93b93988-a027-483e-8c4d-ed58a163fbfa',
  shopperId: 'd002d3a7-2744-4414-8336-afc644ec6878',
};
const append = { id: 'fa91641f-d265-4a3b-9695-4ff553ab5138', sourceId: 'price-local-01', version: 1 };
const createdAt = '2026-11-20T12:00:00.000Z';
const product = { id: 'rice-01', name: 'Rice', productType: 'Dry rice' };
const createProduct: ShoppingMutationInput = {
  operationId: 'add-rice', title: 'Save rice', createdAt, action: { kind: 'create-product', product },
};
const editPrice: ShoppingMutationInput = {
  operationId: 'change-price', title: 'Correct rice price', createdAt,
  action: {
    kind: 'price', priceKey: append.sourceId, base: { kind: 'append', sourceId: append.sourceId },
    change: { action: 'correct', review: { productName: 'Rice', price: '1.25', currency: 'GBP' } },
  },
};

beforeEach(() => {
  mockFiles.clear();
  mockFailMove = false;
});

it('stores a single intended edit in protected owner storage across restarts', async () => {
  const queue = await openShoppingMutationQueue(owner);
  const value = { ...createProduct, action: { kind: 'create-product' as const, product: { ...product } } };
  const write = queue.enqueue(value);
  value.action.product.name = 'A later screen change';
  await write;
  expect(await queue.freeze(createProduct.operationId)).toEqual({
    method: 'PUT', path: '/v1/products/rice-01', body: JSON.stringify({ name: 'Rice', productType: 'Dry rice' }),
  });
  const restarted = await openShoppingMutationQueue({ ...owner, origin: owner.origin + '/' });
  await restarted.enqueue(createProduct);
  await expect(restarted.enqueue(value)).rejects.toThrow('already uses this operation ID');
  expect((await restarted.read()).entries).toHaveLength(1);
  expect(await (await openShoppingMutationQueue({
    ...owner, shopperId: '64db4ca7-3962-4a16-8fee-782f26fd13b4',
  })).read()).toEqual({ entries: [], recovery: [] });
  expect([...mockFiles.keys()].every(path => path.startsWith('file:///documents/'))).toBe(true);
});

it('freezes a product correction only after its earlier creation has a committed version', async () => {
  const queue = await openShoppingMutationQueue(owner);
  const correction: ShoppingMutationInput = {
    operationId: 'correct-rice', title: 'Rename rice', createdAt,
    action: { kind: 'edit-product', product: { ...product, name: 'Basmati rice' },
      base: { kind: 'operation', operationId: createProduct.operationId } },
  };
  await queue.enqueue(createProduct);
  await queue.enqueue(correction);
  expect(await queue.freeze(correction.operationId)).toBeUndefined();
  await queue.freeze(createProduct.operationId);
  for (const receipt of [{}, { id: 'other-rice', version: 1 }, { id: product.id, version: 0 }]) {
    await expect(queue.settle(createProduct.operationId, { kind: 'applied', receipt })).rejects.toThrow('product acknowledgement');
    expect(await queue.freeze(correction.operationId)).toBeUndefined();
  }
  await queue.settle(createProduct.operationId, { kind: 'applied', receipt: { id: product.id, version: 1 } });
  expect(await queue.freeze(correction.operationId)).toEqual({
    method: 'PATCH', path: '/v1/products/rice-01',
    body: JSON.stringify({ operationId: 'correct-rice', expectedVersion: 1, product: { name: 'Basmati rice', productType: 'Dry rice' } }),
  });
  await expect(queue.settle(correction.operationId, { kind: 'applied', receipt: {} })).rejects.toThrow('version');
});

it('keeps a reviewed offline correction separate from the original append through restart and retry', async () => {
  const queue = await openShoppingMutationQueue(owner);
  await queue.enqueue(editPrice);
  expect(await queue.freeze(editPrice.operationId)).toBeUndefined();
  expect(await queue.freeze(editPrice.operationId, async () => ({ ...append, sourceId: 'different-price' }))).toBeUndefined();

  const restarted = await openShoppingMutationQueue(owner);
  const patch = await restarted.freeze(editPrice.operationId, async () => append);
  expect(patch).toEqual({
    method: 'PATCH', path: `/v1/me/price-observations/${append.id}`,
    body: JSON.stringify({ operationId: editPrice.operationId, expectedVersion: 1,
      action: 'correct', review: { productName: 'Rice', price: '1.25', currency: 'GBP' },
    }),
  });
  await restarted.fail(editPrice.operationId, 'offline');
  const replay = await openShoppingMutationQueue(owner);
  expect(await replay.freeze(editPrice.operationId)).toEqual(patch);
  expect((await replay.read()).entries[0].failure).toBe('offline');
  await replay.settle(editPrice.operationId, { kind: 'applied', receipt: { id: append.id, version: 2 } });

  await replay.enqueue({
    operationId: 'mark-price', title: 'Mark rice as recorded in error', createdAt,
    action: { kind: 'price', priceKey: append.sourceId,
      base: { kind: 'operation', operationId: editPrice.operationId },
      change: { action: 'record_in_error', reason: 'Wrong shelf' },
    },
  });
  const next = await replay.freeze('mark-price');
  expect(JSON.parse(next?.body ?? '{}')).toEqual({
    operationId: 'mark-price', expectedVersion: 2, action: 'record_in_error', reason: 'Wrong shelf',
  });
  await replay.settle('mark-price', { kind: 'conflict', currentVersion: 3, current: { id: append.id, recordedInErrorReason: 'Duplicate' } });
  const { entries } = await (await openShoppingMutationQueue(owner)).read();
  expect(entries.find(entry => entry.intent.operationId === 'mark-price')).toMatchObject({
    request: next, outcome: { kind: 'conflict', currentVersion: 3, current: { recordedInErrorReason: 'Duplicate' } },
  });
});

it('surfaces an interrupted publication and preserves unrelated scheduled ordering', async () => {
  const queue = await openShoppingMutationQueue(owner);
  await queue.enqueue(createProduct);
  mockFailMove = true;
  await expect(queue.enqueue(editPrice)).rejects.toThrow('Interrupted');
  mockFailMove = false;
  const restarted = await openShoppingMutationQueue(owner);
  expect((await restarted.read()).recovery).toEqual([{ operationId: editPrice.operationId, reason: 'unfinished' }]);
  await restarted.enqueue(editPrice);
  expect((await restarted.read()).recovery).toEqual([]);
  await restarted.enqueue({
    operationId: 'select-shop', title: 'Choose market', createdAt, action: { kind: 'select-shop', shopId: 'market' },
    waitFor: [createProduct.operationId],
  });
  expect(await restarted.freeze('select-shop')).toBeUndefined();
  await restarted.freeze(createProduct.operationId);
  await restarted.settle(createProduct.operationId, { kind: 'applied', receipt: { id: product.id, version: 1 } });
  expect(await restarted.freeze('select-shop')).toEqual({
    path: '/v1/me/current-shop', method: 'PUT', body: JSON.stringify({ shopId: 'market' }),
  });
});

it('retains the phone and cloud choices for a private preference conflict and stops resending it', async () => {
  const queue = await openShoppingMutationQueue(owner);
  const intent: ShoppingMutationInput = {
    operationId: 'clear-rice-basis', createdAt, title: 'Clear comparison basis',
    action: { kind: 'preference', groupId: 'dry rice', basis: null, base: { kind: 'version', version: 2 } },
  };
  await queue.enqueue(intent);
  const patch = await queue.freeze(intent.operationId);
  expect(patch).toEqual({
    method: 'PATCH', path: '/v1/me/comparison-preferences/dry%20rice',
    body: JSON.stringify({ operationId: 'clear-rice-basis', expectedVersion: 2, basis: null }),
  });
  await queue.settle(intent.operationId, { kind: 'conflict', currentVersion: 3, current: { basis: 'kg' } });
  const restarted = await openShoppingMutationQueue(owner);
  expect((await restarted.read()).entries[0]).toMatchObject({
    intent: { action: { basis: null } }, request: patch, outcome: { kind: 'conflict', current: { basis: 'kg' } },
  });
  expect(await restarted.freeze(intent.operationId)).toBeUndefined();
});

it('retains an immutable branch edit and blocks a dependant from borrowing another branch version', async () => {
  const queue = await openShoppingMutationQueue(owner);
  const version = '3:fa91641f-d265-4a3b-9695-4ff553ab5138';
  const edit: ShoppingMutationInput = {
    operationId: 'rename-market', createdAt, title: 'Rename market',
    action: { kind: 'edit-shop', shopId: 'market', details: { nickname: 'Local market' },
      base: { kind: 'version', version } },
  };
  await queue.enqueue(edit);
  expect(await queue.freeze(edit.operationId)).toEqual({
    method: 'PATCH', path: '/v1/me/saved-shops/market',
    body: JSON.stringify({ operationId: 'rename-market', expectedVersion: version, details: { nickname: 'Local market' } }),
  });
  const otherBranchVersion = '3:aaaaaa11-d265-4a3b-9695-4ff553ab5138';
  await expect(queue.settle(edit.operationId, { kind: 'applied', receipt: { id: 'other', version: otherBranchVersion } }))
    .rejects.toThrow('saved-shop acknowledgement');
  await expect(queue.settle(edit.operationId, { kind: 'applied', receipt: { id: 'market', version: 4 } }))
    .rejects.toThrow('version');
  await expect(queue.enqueue({
    ...edit, operationId: 'rename-other-market',
    action: { kind: 'edit-shop', shopId: 'other', details: { nickname: 'Other market' },
      base: { kind: 'operation', operationId: edit.operationId } },
  })).rejects.toThrow('different record');
});
