import { loadSavedShops, removeShop, saveShop, selectShop, updateShop } from '../data/local-shops';

const mockFiles = new Map<string, string>();
const mockDirectories = new Set<string>();
let mockId = 0;
let mockFailRead = false;
let mockFailPublish = false;
let mockFailWrite = false;

jest.mock('expo-crypto', () => ({ randomUUID: () => `shop-${++mockId}` }));

jest.mock('expo-file-system', () => {
  class File {
    uri: string;

    constructor(parent: Directory | string, name?: string) {
      this.uri = typeof parent === 'string' ? parent : `${parent.uri}/${name}`;
    }

    get name() {
      return this.uri.split('/').at(-1)!;
    }

    async text() {
      if (mockFailRead) throw Error('Read failed');
      if (!mockFiles.has(this.uri)) throw Error('Missing file');
      return mockFiles.get(this.uri)!;
    }

    async write(contents: string) {
      if (mockFailWrite) {
        mockFiles.set(this.uri, '{partial');
        throw Error('Disk full');
      }
      mockFiles.set(this.uri, contents);
    }

    delete() {
      mockFiles.delete(this.uri);
    }
  }

  class Directory {
    uri: string;

    constructor(parent: Directory | string, name?: string) {
      const uri = typeof parent === 'string' ? parent : parent.uri;
      this.uri = name ? `${uri}/${name}` : uri;
    }

    get name() {
      return this.uri.split('/').at(-1)!;
    }

    get exists() {
      return mockDirectories.has(this.uri);
    }

    create(options?: { idempotent?: boolean }) {
      if (mockFailPublish && this.name.endsWith('.committed')) throw Error('Publication failed');
      if (this.exists && !options?.idempotent) throw Error('Directory already exists');
      mockDirectories.add(this.uri);
    }

    delete() {
      mockDirectories.delete(this.uri);
    }

    list() {
      if (mockFailRead) throw Error('Read failed');
      const inside = (uri: string) => uri.startsWith(`${this.uri}/`);
      return [
        ...[...mockFiles.keys()].filter(inside).map((uri) => new File(uri)),
        ...[...mockDirectories].filter(inside).map((uri) => new Directory(uri)),
      ];
    }
  }

  return { Directory, File, Paths: { document: 'file:///documents' } };
});

beforeEach(() => {
  mockFiles.clear();
  mockDirectories.clear();
  mockId = 0;
  mockFailRead = false;
  mockFailPublish = false;
  mockFailWrite = false;
});

it('restores the saved shop list and selection when opened again', async () => {
  expect(await loadSavedShops()).toEqual({ shops: [] });

  const { shops: [lidl] } = await saveShop({ nickname: ' Tandem Centre Lidl ' });
  const { shops: [, sainsburys] } = await saveShop({ name: "Sainsbury's" });
  await selectShop(lidl.id);

  let reopened!: typeof loadSavedShops;
  jest.isolateModules(() => {
    reopened = jest.requireActual<typeof import('../data/local-shops')>('../data/local-shops').loadSavedShops;
  });
  expect(await reopened()).toEqual({
    shops: [lidl, sainsburys],
    currentShop: { id: lidl.id, nickname: 'Tandem Centre Lidl' },
  });
});

it('adds and selects a shop in one save, then updates it by stable ID', async () => {
  const created = await saveShop({ nickname: 'Tandem Centre Lidl' }, { select: true });
  expect(created.currentShop).toEqual({ id: 'shop-1', nickname: 'Tandem Centre Lidl' });

  const edited = await saveShop({ id: 'shop-1', nickname: 'Lidl by the station' });
  expect(edited).toEqual({
    shops: [{ id: 'shop-1', nickname: 'Lidl by the station' }],
    currentShop: { id: 'shop-1', nickname: 'Lidl by the station' },
  });
});

it.each(['write', 'publish'])('keeps saved shops after a failed %s and permits retry', async (failure) => {
  const before = await saveShop({ name: 'Lidl' }, { select: true });
  mockFailWrite = failure === 'write';
  mockFailPublish = failure === 'publish';

  await expect(saveShop({ name: 'Tesco' }, { select: true })).rejects.toThrow('Could not save');
  expect(await loadSavedShops()).toEqual(before);

  mockFailWrite = false;
  mockFailPublish = false;
  expect((await saveShop({ name: 'Tesco' }, { select: true })).currentShop?.name).toBe('Tesco');
});

it('uses no current shop when the stored ID has no matching shop', async () => {
  await saveShop({ name: 'Lidl' });
  const path = 'file:///documents/saved-shops/shops-1.json';
  const snapshot = JSON.parse(mockFiles.get(path)!);
  mockFiles.set(path, JSON.stringify({ ...snapshot, currentShopId: 'missing-shop' }));

  expect(await loadSavedShops()).toEqual({ shops: [{ id: 'shop-1', name: 'Lidl' }] });
  await expect(selectShop('missing-shop')).rejects.toThrow('That shop is no longer saved');
});

it('reports read failures and leaves corrupt shop data and existing photo drafts untouched', async () => {
  const legacyDraftPath = 'file:///documents/price-photos/old-draft.json';
  mockFiles.set(legacyDraftPath, 'legacy photo draft');
  await saveShop({ name: 'Lidl' });

  mockFailRead = true;
  await expect(loadSavedShops()).rejects.toThrow('Could not read');
  mockFailRead = false;

  const shopPath = 'file:///documents/saved-shops/shops-1.json';
  mockFiles.set(shopPath, '{invalid');
  await expect(saveShop({ name: 'Tesco' })).rejects.toThrow('Could not read');
  expect(mockFiles.get(shopPath)).toBe('{invalid');
  expect(mockFiles.get(legacyDraftPath)).toBe('legacy photo draft');
});

it('serializes overlapping saves without losing either shop', async () => {
  await Promise.all([
    saveShop({ name: 'Lidl' }),
    saveShop({ name: 'Tesco' }, { select: true }),
  ]);

  const state = await loadSavedShops();
  expect(state.shops.map((shop) => shop.name)).toEqual(['Lidl', 'Tesco']);
  expect(state.currentShop?.name).toBe('Tesco');
});


it('updates an existing shop without replacing its ID, location, or selection', async () => {
  const location = { latitude: 51.4, longitude: -0.18 };
  const { currentShop: original } = await saveShop({ nickname: 'Local shop', location }, { select: true });
  const id = original!.id;
  await saveShop({ name: 'Other shop' });

  const updated = await updateShop(id, { name: 'Example Market', address: '12 Market Road' });
  expect(updated.currentShop).toEqual({ id, name: 'Example Market', address: '12 Market Road', location });
  expect(updated.shops).toHaveLength(2);
  expect(await loadSavedShops()).toEqual(updated);

  await expect(updateShop(id, { nickname: ' ', name: '' })).rejects.toThrow('Enter a shop nickname or name');
  await expect(updateShop('missing', { name: 'Unexpected shop' })).rejects.toThrow('That shop is no longer saved');
  expect(await loadSavedShops()).toEqual(updated);
});

it('keeps shop details and selection when an edit cannot be published', async () => {
  const before = await saveShop({ name: 'Example Market' }, { select: true });
  mockFailPublish = true;
  await expect(updateShop(before.currentShop!.id, { name: 'Renamed' })).rejects.toThrow('Could not save');
  expect(await loadSavedShops()).toEqual(before);
});

it('clears only a removed current selection and keeps historical photo data intact', async () => {
  const { currentShop } = await saveShop({ name: 'Historic market' }, { select: true });
  const { shops: [, other] } = await saveShop({ name: 'Other shop' });
  const history = JSON.stringify({ shop: { id: currentShop!.id, displayName: currentShop!.name }, price: 2.50 });
  const historyPath = 'file:///documents/price-photos/old-draft.json';
  const photoPath = 'file:///documents/price-photos/old-draft-original.jpg';
  mockFiles.set(historyPath, history);
  mockFiles.set(photoPath, 'original photo data');

  expect(await removeShop(other.id)).toEqual({ shops: [currentShop], currentShop });
  expect(await removeShop(currentShop!.id)).toEqual({ shops: [] });
  expect(await loadSavedShops()).toEqual({ shops: [] });
  expect(mockFiles.get(historyPath)).toBe(history);
  expect(mockFiles.get(photoPath)).toBe('original photo data');
  await expect(updateShop(currentShop!.id, { name: 'Stale edit' })).rejects.toThrow('That shop is no longer saved');
  await expect(removeShop(currentShop!.id)).rejects.toThrow('That shop is no longer saved');
  expect(await loadSavedShops()).toEqual({ shops: [] });
});

it('keeps the shop and current selection if removal cannot be written', async () => {
  const before = await saveShop({ name: 'Example Market' }, { select: true });
  mockFailWrite = true;
  await expect(removeShop(before.currentShop!.id)).rejects.toThrow('Could not save');
  expect(await loadSavedShops()).toEqual(before);
});
