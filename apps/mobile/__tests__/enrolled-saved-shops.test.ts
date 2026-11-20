import { createEnrolledSavedShops } from '../data/enrolled-saved-shops';
import { createCheapoShoppingReads, type EditableSavedShopRead, type ShoppingRead } from '../data/cheapo-shopping-reads';
import type { QueuedShoppingMutation } from '../data/shopping-mutation-queue';
import { requestForMutation, shoppingMutation, type ShoppingMutationInput } from '../data/shopping-mutations';

let mockNextId = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `operation-${++mockNextId}` }));

const shop = { id: 'market', name: 'Market Road' };
const version = '1:fa91641f-d265-4a3b-9695-4ff553ab5138';
const revised = '2:fa91641f-d265-4a3b-9695-4ff553ab5138';
const at = '2026-11-20T01:00:00.000Z';

function fixture(initial: ShoppingRead<EditableSavedShopRead> = { status: 'unavailable' }) {
  const entries: QueuedShoppingMutation[] = [];
  const queue = {
    read: jest.fn(async () => ({ entries, recovery: [] })),
    enqueue: jest.fn(async (value: ShoppingMutationInput) => { entries.push({ intent: shoppingMutation.parse(value) }); }),
  };
  const args = {
    queue,
    loadHosted: jest.fn<Promise<ShoppingRead<EditableSavedShopRead>>, [readonly string[]]>().mockResolvedValue(initial),
    assertCurrent: jest.fn(async () => {}),
    sync: jest.fn(async () => {}),
  };
  return { args, entries, repository: createEnrolledSavedShops(args) };
}

test('queues a shop edit against the version displayed when the shopper started editing', async () => {
  const { args, entries, repository } = fixture({
    status: 'cached', lastSyncedAt: at, value: { shops: [shop], versions: [{ shopId: shop.id, version }] },
  });
  const initial = await repository.loadSavedShops();
  const selectedBase = initial.editBases?.get(shop.id);
  args.loadHosted.mockResolvedValueOnce({
    status: 'fresh', lastSyncedAt: at,
    value: { shops: [{ ...shop, address: 'Peer address' }], versions: [{ shopId: shop.id, version: revised }] },
  });
  await repository.loadSavedShops();
  const saved = await repository.updateShop(shop.id, { name: shop.name, nickname: 'Local nickname' }, selectedBase);

  expect(entries[0].intent.action).toMatchObject({ kind: 'edit-shop', base: { kind: 'version', version } });
  expect(saved.shops[0].nickname).toBe('Local nickname');
  expect(args.loadHosted).toHaveBeenCalledTimes(2);
  expect(args.sync).toHaveBeenCalledTimes(1);
});

test('persists a shop and its selection together, then reopens and chains offline edits by receipt', async () => {
  const { args, entries, repository } = fixture();
  const original = await repository.saveShop(shop, { select: true });
  expect(original.currentShop).toEqual(shop);
  expect(entries).toHaveLength(1);
  expect(JSON.parse(requestForMutation(entries[0].intent)?.body ?? '{}')).toEqual({
    shop: { name: shop.name }, operationId: entries[0].intent.operationId, select: true,
  });

  const reopened = createEnrolledSavedShops(args);
  const view = await reopened.loadSavedShops();
  const saved = await reopened.updateShop(shop.id, { name: shop.name, nickname: 'Local nickname' }, view.editBases?.get(shop.id));
  expect(entries[1].intent.action).toMatchObject({
    kind: 'edit-shop', base: { kind: 'operation', operationId: entries[0].intent.operationId },
  });
  expect(saved.currentShop?.nickname).toBe('Local nickname');
  const removed = await reopened.removeShop(shop.id, saved.editBases?.get(shop.id));
  expect(removed.shops).toEqual([]);
  expect(removed.currentShop).toBeUndefined();
  expect(entries[2].intent.action).toMatchObject({
    kind: 'unlink-shop', base: { kind: 'operation', operationId: entries[1].intent.operationId },
  });
});

test('keeps a checked later cloud version and does not stage a write after an owner change', async () => {
  const { args, entries, repository } = fixture({
    status: 'cached', lastSyncedAt: at,
    value: { shops: [shop], versions: [{ shopId: shop.id, version }] },
  });
  const displayed = await repository.loadSavedShops();
  await repository.updateShop(shop.id, { name: shop.name, nickname: 'Earlier edit' }, displayed.editBases?.get(shop.id));
  entries[0].outcome = { kind: 'applied', receipt: { id: shop.id, version: revised } };
  args.loadHosted.mockResolvedValue({
    status: 'fresh', lastSyncedAt: '2090-01-01T00:00:00.000Z',
    value: { shops: [{ ...shop, nickname: 'Later peer edit' }],
      versions: [{ shopId: shop.id, version: '3:fa91641f-d265-4a3b-9695-4ff553ab5138' }] },
  });
  expect((await repository.loadSavedShops()).shops[0].nickname).toBe('Later peer edit');

  args.assertCurrent.mockRejectedValue(Error('Cheapo access changed.'));
  await expect(repository.saveShop({ name: 'Unrelated branch' })).rejects.toThrow('access changed');
  expect(entries).toHaveLength(1);
});

test('uses the chosen cloud conflict when the available cache still shows the rejected base', async () => {
  const { entries, repository } = fixture({
    status: 'cached', lastSyncedAt: at,
    value: { shops: [shop], versions: [{ shopId: shop.id, version }] },
  });
  const displayed = await repository.loadSavedShops();
  await repository.updateShop(shop.id, { ...shop, nickname: 'Phone change' }, displayed.editBases?.get(shop.id));
  entries[0].outcome = { kind: 'conflict', currentVersion: revised, current: { ...shop, nickname: 'Cloud change' } };
  entries[0].resolution = { kind: 'keep-cloud', laterIds: [] };

  const settled = await repository.loadSavedShops();
  expect(settled.shops[0].nickname).toBe('Cloud change');
  expect(settled.editBases?.get(shop.id)).toEqual({ kind: 'version', version: revised });
});

const third = '3:fa91641f-d265-4a3b-9695-4ff553ab5138';
const fourth = '4:fa91641f-d265-4a3b-9695-4ff553ab5138';
const changedNickname = '3:069fa20e-3e3a-4a61-aed1-60a5c8ec4298';
const relinked = '1:522cca18-bdbd-448f-9715-c55dd4dca19e';

test.each([
  { settlement: 'accepted', cached: version, settled: third, projected: true },
  { settlement: 'accepted', cached: fourth, settled: third, projected: false },
  { settlement: 'accepted', cached: version, settled: changedNickname, projected: true },
  { settlement: 'accepted', cached: relinked, settled: changedNickname, projected: false },
  { settlement: 'keep-cloud', cached: version, settled: fourth, projected: true },
  { settlement: 'keep-cloud', cached: third, settled: fourth, projected: true },
  { settlement: 'keep-cloud', cached: fourth, settled: third, projected: false },
  { settlement: 'keep-cloud', cached: version, settled: changedNickname, projected: true },
  { settlement: 'keep-cloud', cached: relinked, settled: changedNickname, projected: false },
] as const)(
  'projects $settlement=$settled over cached $cached after restart: $projected',
  async ({ settlement, cached, settled, projected }) => {
    const { args, entries, repository } = fixture({
      status: 'fresh', lastSyncedAt: at,
      value: { shops: [shop], versions: [{ shopId: shop.id, version: revised }] },
    });
    const displayed = await repository.loadSavedShops();
    await repository.updateShop(shop.id, { ...shop, nickname: 'Phone change' }, displayed.editBases?.get(shop.id));
    if (settlement === 'accepted') entries[0].outcome = { kind: 'applied', receipt: { id: shop.id, version: settled } };
    else {
      entries[0].outcome = { kind: 'conflict', currentVersion: settled, current: { ...shop, nickname: 'Cloud choice' } };
      entries[0].resolution = { kind: 'keep-cloud', laterIds: [] };
    }
    args.loadHosted.mockResolvedValue({
      status: 'cached', lastSyncedAt: at, observedOperationIds: [],
      value: { shops: [{ ...shop, nickname: 'Cached' }], versions: [{ shopId: shop.id, version: cached }] },
    });
    const restarted = createEnrolledSavedShops(args);
    const result = await restarted.loadSavedShops();
    expect(result.shops[0].nickname).toBe(projected ? (settlement === 'accepted' ? 'Phone change' : 'Cloud choice') : 'Cached');
    expect(result.editBases?.get(shop.id)).toEqual({ kind: 'version', version: projected ? settled : cached });
  },
);

test.each(['save', 'select', 'unlink'] as const)(
  'keeps the accepted %s over a pre-acknowledgement read after an offline restart',
  async action => {
    const second = { id: 'other', name: 'Other shop' };
    const view = { shops: [shop, second], currentShop: shop,
      versions: [{ shopId: shop.id, version }, { shopId: second.id, version }] };
    const { args, entries } = fixture();
    const persisted = new Map<string, string>();
    const cache = {
      async read(key: string) { return persisted.get(key) ?? null; },
      async write(key: string, text: string) { persisted.set(key, text); },
      async remove(key: string) { persisted.delete(key); },
    };
    const get = jest.fn<Promise<Response>, [string, AbortSignal?]>();
    const read = createCheapoShoppingReads(async () => ({ cacheScope: 'test-scope', get, assertCurrent() {} }), cache);
    args.loadHosted.mockImplementation(observed => read.loadEditableSavedShops(undefined, observed));
    get.mockResolvedValueOnce(Response.json(view));
    const repository = createEnrolledSavedShops(args);
    const shown = await repository.loadSavedShops();
    const newShop = { id: 'new-shop', name: 'New shop' };
    if (action === 'save') await repository.saveShop(newShop, { select: true });
    else if (action === 'select') await repository.selectShop(second.id);
    else await repository.removeShop(shop.id, shown.editBases?.get(shop.id));

    const response = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    get.mockImplementationOnce(() => { started.resolve(); return response.promise; });
    const inFlight = repository.loadSavedShops();
    await started.promise;
    const acceptedId = entries[0].intent.operationId;
    entries[0].outcome = { kind: 'applied', receipt: { id: action === 'save' ? newShop.id : action === 'select' ? second.id : shop.id,
      ...(action === 'save' ? { version } : {}) } };
    response.resolve(Response.json(view));

    function checkAccepted(state: Awaited<ReturnType<typeof repository.loadSavedShops>>) {
      if (action === 'save') expect(state.currentShop).toEqual(newShop);
      else if (action === 'select') expect(state.currentShop).toEqual(second);
      else {
        expect(state.currentShop).toBeUndefined();
        expect(state.shops.map(item => item.id)).toEqual([second.id]);
      }
    }
    checkAccepted(await inFlight);

    get.mockRejectedValueOnce(Error('Offline'));
    const restarted = createEnrolledSavedShops(args);
    const cached = await restarted.loadSavedShops();
    checkAccepted(cached);
    expect(cached.sync?.status).toBe('cached');
    expect(JSON.parse([...persisted.values()][0]).observedOperationIds).toEqual([]);

    // A read that starts after the local acknowledgement may show a later
    // server choice or re-link. It takes precedence over replayed intent.
    const later = { ...view, versions: [{ shopId: shop.id, version: revised }, view.versions[1]] };
    get.mockResolvedValueOnce(Response.json(later));
    const checked = await restarted.loadSavedShops();
    expect(checked.shops).toEqual(view.shops);
    expect(checked.currentShop).toEqual(shop);
    expect(JSON.parse([...persisted.values()][0]).observedOperationIds).toEqual([acceptedId]);
  },
);

test('marks an enrolled first read without a checked snapshot as unavailable', async () => {
  const { repository } = fixture();
  expect(await repository.loadSavedShops()).toMatchObject({ shops: [], sync: { status: 'unavailable' } });
});
