import { emptyReview, reviewComplete, loadLocalPhotos, saveLocalPhoto, saveLocalPhotoReview, type LocalPhotoDraft } from '../data/local-photo';
const mockFiles = new Map<string, string>();
let mockFailCopy = false;
let mockFailWrite = false;
let mockPartialWrite = false;
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) { this.uri = (typeof parent === 'string' ? parent : parent.uri) + (name ? '/' + name : ''); }
    get name() { return this.uri.split('/').pop()!; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.length ?? 0; }
    async copy(target: File) { await new Promise(resolve => setTimeout(resolve, 1)); if (mockFailCopy) throw Error('Disk full'); mockFiles.set(target.uri, mockFiles.get(this.uri)!); }
    async write(value: string) { await new Promise(resolve => setTimeout(resolve, 1)); if (mockFailWrite) throw Error('Manifest could not be written'); if (mockPartialWrite && this.name.endsWith('.json')) { mockFiles.set(this.uri, '{partial'); throw Error('Interrupted manifest write'); } mockFiles.set(this.uri, value); }
    async text() { return mockFiles.get(this.uri); }
  }
  class Directory {
    uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    create() {}
    get exists() { return true; }
    list() { return [...mockFiles.keys()].filter(key => key.startsWith(this.uri + '/')).map(key => new File(key)); }
  }
  return { Directory, File, Paths: { document: 'file:///documents' } };
});
const draft: LocalPhotoDraft = { id: 'capture-1', capturedAt: '2026-11-10T12:00:00Z', original: { uri: 'file:///camera.jpg', width: 1000, height: 500, mimeType: 'image/jpeg' }, selected: { uri: 'file:///crop.jpg', width: 500, height: 250, mimeType: 'image/jpeg' } };
beforeEach(() => { mockFiles.clear(); mockFailCopy = false; mockFailWrite = false; mockPartialWrite = false; mockFiles.set('file:///camera.jpg', 'original JPEG'); mockFiles.set('file:///crop.jpg', 'cropped JPEG'); });
it('restores both original and selected photos after temporary camera files disappear', async () => {
  await saveLocalPhoto(draft);
  mockFiles.delete('file:///camera.jpg'); mockFiles.delete('file:///crop.jpg');
  const restored = await loadLocalPhotos();
  expect(restored).toHaveLength(1);
  expect(restored[0].original).toMatchObject({ width: 1000, height: 500, size: 13 });
  expect(restored[0].selected).toMatchObject({ width: 500, height: 250, size: 12 });
  expect(restored[0].selected.uri).toMatch(/^file:\/\/\/documents\/price-photos\//);
});
it('does not publish a saved draft when copying fails', async () => {
  mockFailCopy = true;
  await expect(saveLocalPhoto(draft)).rejects.toThrow('Disk full');
  expect(await loadLocalPhotos()).toEqual([]);
});

it('requires valid manual details before a draft is complete', () => {
  expect(reviewComplete(emptyReview())).toBe(false);
  const review = { ...emptyReview('Tesco Borough Road'), productName: 'Milk 2 litres', price: '1.65' };
  expect(reviewComplete(review)).toBe(true);
  expect(reviewComplete({ ...review, productName: '   ' })).toBe(false);
  expect(reviewComplete({ ...review, shop: '   ' })).toBe(false);
  expect(reviewComplete({ ...review, productName: '  ' + 'a'.repeat(200), shop: 'b'.repeat(150) + '  ' })).toBe(true);
  expect(reviewComplete({ ...review, productName: 'a'.repeat(201) })).toBe(false);
  expect(reviewComplete({ ...review, shop: 'b'.repeat(151) })).toBe(false);
  expect(reviewComplete({ ...review, price: '-1' })).toBe(false);
  expect(reviewComplete({ ...review, price: '1,65' })).toBe(false);
  expect(reviewComplete({ ...review, currency: '' })).toBe(false);
  expect(reviewComplete({ ...review, unitPrice: '0.83', unit: '' })).toBe(false);
  expect(reviewComplete({ ...review, unitPrice: '', unit: 'kg' })).toBe(false);
  expect(reviewComplete({ ...review, unitPrice: '0.123456', unit: 'kg' })).toBe(true);
  expect(reviewComplete({ ...review, unitPrice: '0.83', unit: 'litre' })).toBe(true);
});

it('waits for the manifest write and rejects if durable draft publication fails', async () => {
  mockFailWrite = true;
  await expect(saveLocalPhoto(draft)).rejects.toThrow('Manifest could not be written');
  expect(await loadLocalPhotos()).toEqual([]);
});

it('skips malformed metadata without hiding other saved photos',async()=>{
  await saveLocalPhoto(draft);
  const good=JSON.parse(mockFiles.get('file:///documents/price-photos/capture-1.json')!);
  const malformed=[
    {...good,id:'missing-date',capturedAt:undefined},
    {...good,id:'invalid-date',capturedAt:'not-a-date'},
    {...good,id:'bad-dimensions',selected:{...good.selected,width:0}},
    {...good,id:'bad-review',review:{...emptyReview(),price:123}},
    {...good,id:'bad-crop',cropBox:{left:0,top:0,right:2,bottom:1}},
  ];
  for(const value of malformed)mockFiles.set(`file:///documents/price-photos/${value.id}.json`,JSON.stringify(value));
  expect((await loadLocalPhotos()).map(value=>value.id)).toEqual(['capture-1']);
});

it('requires every saved capture and photo for a complete export', async () => {
  const saved = await saveLocalPhoto(draft);
  await expect(loadLocalPhotos({ requireAll: true })).resolves.toEqual([saved]);
  mockFiles.delete(saved.selected.uri);
  await expect(loadLocalPhotos({ requireAll: true })).rejects.toThrow('could not export the full collection');
  await expect(loadLocalPhotos()).resolves.toEqual([]);
});

it('restores the last good saved record after an interrupted edit, including repeated retries',async()=>{
  const saved=await saveLocalPhoto({...draft,review:{...emptyReview('Original shop'),productName:'Rice',price:'1.25'}});
  mockPartialWrite=true;
  const changed={...saved,review:{...saved.review!,price:'2.50'}};
  await expect(saveLocalPhoto(changed)).rejects.toThrow('Interrupted manifest write');
  expect((await loadLocalPhotos())[0].review?.price).toBe('1.25');
  // A retry must not replace the good backup with the corrupt primary.
  await expect(saveLocalPhoto(changed)).rejects.toThrow('Interrupted manifest write');
  expect((await loadLocalPhotos())[0].review?.price).toBe('1.25');
  mockPartialWrite=false;await saveLocalPhoto(changed);
  expect(await loadLocalPhotos()).toHaveLength(1);
  expect((await loadLocalPhotos())[0].review?.price).toBe('2.50');
});
it('leaves the primary unchanged if its safety copy cannot be written',async()=>{
  const saved=await saveLocalPhoto(draft);const original=mockFiles.get('file:///documents/price-photos/capture-1.json');
  mockFailWrite=true;
  await expect(saveLocalPhoto(saved)).rejects.toThrow();
  expect(mockFiles.get('file:///documents/price-photos/capture-1.json')).toBe(original);
  expect(await loadLocalPhotos()).toHaveLength(1);
});

it('reads a previous draft with free-text review fields and both photo references', async () => {
  const legacyDraft = {
    id: 'old-draft',
    capturedAt: '2026-11-10T12:00:00Z',
    original: { uri: 'file:///documents/price-photos/old-original.jpg', width: 1000, height: 500, mimeType: 'image/jpeg' },
    selected: { uri: 'file:///documents/price-photos/old-selected.jpg', width: 500, height: 250, mimeType: 'image/jpeg' },
    review: { productName: '  Basmati rice  ', shop: ' My Tesco ', price: '', currency: 'GBP', unitPrice: '', unit: '' },
  };
  mockFiles.set(legacyDraft.original.uri, 'original JPEG');
  mockFiles.set(legacyDraft.selected.uri, 'cropped JPEG');
  mockFiles.set('file:///documents/price-photos/old-draft.json', JSON.stringify(legacyDraft));

  const restored = await loadLocalPhotos();
  expect(restored).toEqual([legacyDraft]);
  expect(reviewComplete(restored[0].review)).toBe(false);
});

it('restores a shop snapshot with its original ID and display name', async () => {
  const shop = { id: 'lidl-tandem', displayName: 'Tandem Centre Lidl' };
  await saveLocalPhoto({ ...draft, shop, review: emptyReview(shop.displayName) });

  expect((await loadLocalPhotos())[0].shop).toEqual(shop);
});

it('retains optional classification and pack size after saving', async () => {
  const review = { ...emptyReview('Original shop'), productName: 'Rice', price: '1.25', productType: 'Dry rice', variety: 'Basmati', brand: 'Example brand', packSize: '500 g' };
  await saveLocalPhoto({ ...draft, review });
  expect((await loadLocalPhotos())[0].review).toEqual(review);
  expect(reviewComplete(review)).toBe(true);
});


it('updates only the existing review and never recopies the capture', async () => {
  const shop = { id: 'test-shop', displayName: 'Test shop' };
  const review = { ...emptyReview('Test shop'), productName: 'Tilda rice', price: '2.50', unitPrice: '0.25', unit: '100g' };
  const saved = await saveLocalPhoto({ ...draft, shop, review });
  mockFailCopy = true;
  const changed = { ...review, shop: 'Wrong shop', unitPrice: '2.50', unit: 'kg' };
  await saveLocalPhotoReview(saved.id, changed);
  expect(await loadLocalPhotos()).toEqual([{ ...saved, review: { ...changed, shop: 'Test shop' } }]);
  expect([...mockFiles.keys()].filter(path => path.startsWith('file:///documents') && path.endsWith('.jpg'))).toHaveLength(2);
});

it('keeps the prior review on interrupted edits and rejects missing or unsafe record IDs', async () => {
  const review = { ...emptyReview('Legacy shop'), productName: 'Rice', price: '1.25' };
  const saved = await saveLocalPhoto({ ...draft, review });
  mockPartialWrite = true;
  await expect(saveLocalPhotoReview(saved.id, { ...review, price: '2.50' })).rejects.toThrow('Interrupted manifest write');
  expect(await loadLocalPhotos()).toEqual([saved]);
  mockPartialWrite = false;
  await expect(saveLocalPhotoReview('absent', review)).rejects.toThrow('Saved product unavailable');
  await expect(saveLocalPhotoReview('../absent', review)).rejects.toThrow('Saved product unavailable');
  await expect(saveLocalPhotoReview(saved.id, { ...review, unitPrice: '1' })).rejects.toThrow('valid product and price');
  expect(await loadLocalPhotos()).toEqual([saved]);
});
