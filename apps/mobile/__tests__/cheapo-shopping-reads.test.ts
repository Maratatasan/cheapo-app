import { createCheapoAccess } from "../lib/cheapo-access/client";
import { createCheapoShoppingReads } from "../data/cheapo-shopping-reads";

const origin = "https://cheapo.example";
const first = `cheapo_${"A".repeat(43)}`;
const second = `cheapo_${"B".repeat(43)}`;
const identity = {
  householdId: "93b93988-a027-483e-8c4d-ed58a163fbfa",
  shopperId: "d002d3a7-2744-4414-8336-afc644ec6878",
};

function setup() {
  let enrollment: string | null = JSON.stringify({ origin, credential: first });
  const protectedStorage = {
    getItem: async () => enrollment,
    setItem: async (_key: string, value: string) => { enrollment = value; },
    deleteItem: async () => { enrollment = null; },
  };
  const download = jest.fn<Promise<Response>, [string, RequestInit]>();
  const cache = new Map<string, string>();
  let generation = 0;
  const snapshot = {
    revision: () => generation,
    async read(key: string) { return cache.get(key) ?? null; },
    async write(key: string, text: string) { cache.set(key, text); },
    async remove(key: string) { cache.delete(key); },
  };
  const access = createCheapoAccess(origin, protectedStorage, download,
    async (key: string) => key.endsWith(first) ? "fixture-scope-one" : "fixture-scope-two");
  const start = () => createCheapoShoppingReads(access.openReadSession, snapshot);
  return { access, download, cache, start, clear() { generation += 1; cache.clear(); } };
}

test("reopens a previously loaded shop snapshot offline with its actual freshness", async () => {
  const { download, start } = setup();
  const shop = { id: "branch", name: "Market", nickname: "Our market", testShop: true };
  download.mockResolvedValueOnce(Response.json({ shops: [shop], currentShop: shop }));
  const loaded = await start().loadSavedShops();
  expect(loaded).toEqual({ status: "fresh", value: { shops: [shop], currentShop: shop }, lastSyncedAt: expect.any(String) });
  download.mockRejectedValueOnce(new Error("Offline"));
  expect(await start().loadSavedShops()).toEqual({ ...loaded, status: "cached" });
});

test('discards a shopping response already in flight when the user clears cache', async () => {
  const { cache, clear, download, start } = setup();
  const response = Promise.withResolvers<Response>();
  const began = Promise.withResolvers<void>();
  download.mockImplementationOnce(() => { began.resolve(); return response.promise; });
  const request = start().loadSavedShops();
  await began.promise;
  clear();
  response.resolve(Response.json({ shops: [{ id: 'old-branch', name: 'Old market' }] }));
  await expect(request).rejects.toThrow();
  expect(cache.size).toBe(0);

  download.mockRejectedValueOnce(Error('Offline'));
  await expect(start().loadSavedShops()).resolves.toEqual({ status: 'unavailable' });
  download.mockResolvedValueOnce(Response.json({ shops: [{ id: 'new-branch', name: 'New market' }] }));
  await expect(start().loadSavedShops()).resolves.toMatchObject({ status: 'fresh' });
  expect(cache.size).toBe(1);
});

test("uses a single cached canonical barcode and clears the cached hit after a checked miss", async () => {
  const { download, start } = setup();
  const reads = start();
  const product = { id: "oats", name: "Oats", barcode: "00012345678905" };
  download.mockResolvedValueOnce(Response.json({ product }));
  const loaded = await reads.findProductByBarcode("012345678905");
  expect(loaded).toMatchObject({ status: "fresh", value: { product } });
  expect(download.mock.calls[0][0]).toBe(origin + "/v1/products?gtin=00012345678905");
  download.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(await reads.findProductByBarcode("0012345678905")).toEqual({ ...loaded, status: "cached" });

  download.mockResolvedValueOnce(Response.json({ product: null }));
  expect(await reads.findProductByBarcode("012345678905")).toMatchObject({ status: "fresh", value: { product: null } });
  download.mockRejectedValueOnce(new Error("Offline"));
  expect(await reads.findProductByBarcode("012345678905")).toEqual({ status: "unavailable" });
});

test.each([401, 403])("does not open cached household records when the service responds %i", async status => {
  const { download, start } = setup();
  const reads = start();
  download.mockResolvedValueOnce(Response.json({ shops: [{ id: "market", name: "Market" }] }));
  await reads.loadSavedShops();
  download.mockResolvedValueOnce(new Response(null, { status }));
  await expect(reads.loadSavedShops()).rejects.toThrow("Cheapo access ended");
});

test("does not reuse another enrollment's snapshots or store the credential in the cache", async () => {
  const { access, cache, download, start } = setup();
  const reads = start();
  download.mockResolvedValueOnce(Response.json({ shops: [{ id: "market", name: "Market" }] }));
  await reads.loadSavedShops();
  const persisted = JSON.stringify([...cache]);
  expect(persisted).not.toContain(first);
  expect([...cache.keys()]).toEqual(["fixture-scope-one\0/v1/me/saved-shops"]);
  download.mockResolvedValueOnce(Response.json(identity));
  await access.enroll(second);
  download.mockRejectedValueOnce(new Error("Offline"));
  expect(await reads.loadSavedShops()).toEqual({ status: "unavailable" });
});

test("discards an old in-flight read when the phone re-enrolls", async () => {
  const { access, cache, download, start } = setup();
  let complete!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { complete = resolve; });
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  download.mockImplementationOnce(() => { started(); return pending; });
  const reading = start().loadSavedShops();
  await requestStarted;

  download.mockResolvedValueOnce(Response.json(identity));
  await access.enroll(second);
  complete(Response.json({ shops: [{ id: "old", name: "Old household" }] }));
  await expect(reading).rejects.toThrow("Cheapo access changed");
  expect(cache.size).toBe(0);
});

test("does not store raw branch search responses or unreadable remote snapshots", async () => {
  const { download, cache, start } = setup();
  const reads = start();
  download.mockResolvedValueOnce(Response.json({ shops: [{ id: "branch", address: "High Street" }] }));
  expect(await reads.searchShopCandidates("High Street")).toMatchObject({
    status: "fresh", value: [{ id: "branch", address: "High Street" }],
  });
  download.mockResolvedValueOnce(Response.json({ shops: [{ id: "branch", testShop: "not a flag" }] }));
  await expect(reads.loadSavedShops()).rejects.toThrow("unreadable");
  expect(cache.size).toBe(0);
});

test('reads bounded identity matches without caching names or observation details', async () => {
  const { cache, download, start } = setup();
  const reads = start();
  const identity = { name: ' Oats & grains ', brand: ' Sample ', variety: '', packSize: ' 500g ' };
  const candidates = [
    { kind: 'catalog', product: { id: 'oats', name: 'Oats & grains', comparableGroupId: 'rolled-oats' } },
    { kind: 'unlinked_observation', observationId: 'fa91641f-d265-4a3b-9695-4ff553ab5138',
      details: { name: 'Oats & grains', brand: 'Sample', pack: { quantity: 500, unit: 'g' }, packSize: '500g' } },
  ];
  download.mockResolvedValueOnce(Response.json({ candidates, truncated: true }));
  await expect(reads.searchProductCandidates(identity)).resolves.toMatchObject({
    status: 'fresh', value: { candidates, truncated: true },
  });
  expect(download.mock.calls[0][0]).toBe(
    `${origin}/v1/product-candidates?name=Oats+%26+grains&brand=Sample&packSize=500g`,
  );

  download.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(reads.searchProductCandidates(identity)).resolves.toEqual({ status: 'unavailable' });
  download.mockResolvedValueOnce(Response.json({ candidates: [], truncated: false }));
  await expect(reads.searchProductCandidates(identity)).resolves.toMatchObject({
    status: 'fresh', value: { candidates: [], truncated: false },
  });
  expect(cache.size).toBe(0);
});

test.each([
  { candidates: [], truncated: 'false' },
  { candidates: [{ kind: 'unlinked_observation', observationId: 'missing', details: { name: 'Oats' } }], truncated: false },
  { candidates: Array.from({ length: 9 }, (_, index) => ({ kind: 'catalog', product: { id: `oats-${index}`, name: 'Oats' } })),
    truncated: true },
])('rejects unreadable or oversized possible product matches', async payload => {
  const { cache, download, start } = setup();
  download.mockResolvedValueOnce(Response.json(payload));
  await expect(start().searchProductCandidates({ name: 'Oats' })).rejects.toThrow('unreadable');
  expect(cache.size).toBe(0);
});

const historyPath = "/v1/me/price-observations";
const observed = {
  id: "fa91641f-d265-4a3b-9695-4ff553ab5138", sourceId: "fixture-price", ownedByCurrentShopper: true,
  version: 2, capturedAt: "2026-01-02T09:30:00.123456Z", productId: "oats", sourceProductId: null,
  productName: "Oats", shopId: null, sourceShopId: "historic-branch", shopDisplayName: "Historic market",
  priceAmount: "3.1900", currency: "GBP", review: { productName: "Oats" }, unitPrice: { amount: 0.638, unit: "100g" },
  photos: [{ role: "original", width: 800, height: 600 }, { role: "crop", width: 400, height: 300, availability: "pending" }],
};

test("reads bounded comparison pages and recovers just the matching offline snapshot", async () => {
  const { download, start } = setup();
  const reads = start();
  const query = { comparableGroupId: "oats+whole", productType: " rolled oats ", currency: "GBP", limit: 20 };
  const nextCursor = "fixture-next";
  download.mockResolvedValueOnce(Response.json({ observations: [observed], nextCursor }));
  const firstPage = await reads.loadPriceHistory(query);
  expect(firstPage).toMatchObject({ status: "fresh", value: { observations: [observed], nextCursor }, lastSyncedAt: expect.any(String) });
  expect(download.mock.calls[0][0]).toBe(origin + historyPath + "?limit=20&comparableGroupId=oats%2Bwhole&productType=rolled+oats&currency=GBP");
  const peer = { ...observed, id: "5353588d-923b-4f09-903d-f72adeaded5a", ownedByCurrentShopper: false };
  download.mockResolvedValueOnce(Response.json({ observations: [peer], nextCursor: null }));
  expect(await reads.loadPriceHistory({ ...query, cursor: nextCursor })).toMatchObject({ status: "fresh", value: { observations: [peer] } });
  expect(download.mock.calls[1][0]).toContain("cursor=fixture-next");
  download.mockRejectedValue(new Error("Offline"));
  expect(await reads.loadPriceHistory({ ...query, productType: "rolled oats" })).toEqual({ ...firstPage, status: "cached" });
  expect(await reads.loadPriceHistory({ ...query, currency: "USD" })).toEqual({ status: "unavailable" });
});

test("opens exact detail with evidence roles and removes the cached detail after a checked 404", async () => {
  const { download, cache, start } = setup();
  const reads = start();
  const detail = { ...observed, cropBox: { left: 0, top: 0.1, right: 0.9, bottom: 0.8 }, selectedPhotoRole: "crop" };
  // Metadata snapshots contain evidence roles only, even if a response includes extra object URL fields.
  const withUnexpectedUrl = { ...detail, photos: [{ ...detail.photos[0], url: "https://object.example/private-fixture" }, detail.photos[1]] };
  download.mockResolvedValueOnce(Response.json({ observation: withUnexpectedUrl }));
  const result = await reads.loadPriceObservation(observed.id);
  expect(result).toMatchObject({ status: "fresh", value: { observation: detail } });
  expect(download.mock.calls[0][0]).toBe(`${origin}${historyPath}/${observed.id}`);
  expect(JSON.stringify([...cache])).not.toContain("object.example");
  download.mockRejectedValueOnce(new Error("Offline"));
  expect(await reads.loadPriceObservation(observed.id)).toEqual({ ...result, status: "cached" });
  download.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await reads.loadPriceObservation(observed.id)).toMatchObject({ status: "fresh", value: { observation: null } });
  download.mockRejectedValueOnce(new Error("Offline"));
  expect(await reads.loadPriceObservation(observed.id)).toEqual({ status: "unavailable" });
});

test("rejects overflowing queries and untrustworthy observation identity or ownership", async () => {
  const { download, cache, start } = setup();
  const reads = start();
  expect(() => reads.loadPriceHistory({ limit: 51 })).toThrow("price history filter");
  expect(() => reads.loadPriceHistory({ productType: "whole oats", includeRecordedInError: true })).toThrow("price history filter");
  expect(() => reads.loadPriceObservation("../saved-shops")).toThrow("price ID");
  expect(download).not.toHaveBeenCalled();
  download.mockResolvedValueOnce(Response.json({ observations: [{ ...observed, ownedByCurrentShopper: "yes" }], nextCursor: null }));
  await expect(reads.loadPriceHistory()).rejects.toThrow("unreadable");
  download.mockResolvedValueOnce(Response.json({ observation: { ...observed, cropBox: null, selectedPhotoRole: "original" } }));
  await expect(reads.loadPriceObservation("5353588d-923b-4f09-903d-f72adeaded5a")).rejects.toThrow("unreadable");
  expect(cache.size).toBe(0);
});

test.each(["fetch", "body"])("falls back to the saved result when the %s stalls and ignores a late success", async stage => {
  jest.useFakeTimers();
  try {
    const { cache, download, start } = setup();
    const reads = start();
    const firstPage = { observations: [observed], nextCursor: null };
    const latePage = { observations: [{ ...observed, version: 99 }], nextCursor: null };
    download.mockResolvedValueOnce(Response.json(firstPage));
    const saved = await reads.loadPriceHistory();
    const before = [...cache];
    let settle!: () => void;
    if (stage === "fetch") {
      download.mockImplementationOnce(() => new Promise(resolve => { settle = () => resolve(Response.json(latePage)); }));
    } else {
      const response = new Response(null);
      jest.spyOn(response, "json").mockImplementation(() => new Promise(resolve => { settle = () => resolve(latePage); }));
      download.mockResolvedValueOnce(response);
    }
    const pending = reads.loadPriceHistory();
    await jest.advanceTimersByTimeAsync(35_000);
    expect(await pending).toEqual({ ...saved, status: "cached" });
    expect(download.mock.calls[1][1].signal?.aborted).toBe(true);
    settle();
    await jest.advanceTimersByTimeAsync(0);
    expect([...cache]).toEqual(before);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("rejects caller cancellation while a response body is still pending", async () => {
  const { cache, download, start } = setup();
  const reads = start();
  const controller = new AbortController();
  download.mockResolvedValueOnce(Response.json({ observations: [observed], nextCursor: null }));
  await reads.loadPriceHistory();
  const before = [...cache];
  const response = new Response(null);
  jest.spyOn(response, "json").mockImplementation(() => {
    controller.abort();
    return new Promise(() => {});
  });
  download.mockResolvedValueOnce(response);
  await expect(reads.loadPriceHistory({}, controller.signal)).rejects.toThrow("interrupted");
  expect(download.mock.calls[1][1].signal?.aborted).toBe(true);
  expect([...cache]).toEqual(before);
});

test("rejects a timed-out read after enrollment changes even when its old cache exists", async () => {
  jest.useFakeTimers();
  try {
    const { access, cache, download, start } = setup();
    const reads = start();
    download.mockResolvedValueOnce(Response.json({ observations: [observed], nextCursor: null }));
    await reads.loadPriceHistory();
    const before = [...cache];
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    download.mockImplementationOnce(() => { markStarted(); return new Promise(() => {}); });
    const pending = expect(reads.loadPriceHistory()).rejects.toThrow("Cheapo access changed");
    await started;
    download.mockResolvedValueOnce(Response.json(identity));
    await access.enroll(second);
    await jest.advanceTimersByTimeAsync(35_000);
    await pending;
    expect([...cache]).toEqual(before);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test("caches the paired editable shop snapshot independently from the unversioned list", async () => {
  const { download, cache, start } = setup();
  const reads = start();
  const shop = { id: "market", name: "Market" };
  const version = "1:fa91641f-d265-4a3b-9695-4ff553ab5138";
  const value = { shops: [shop], versions: [{ shopId: shop.id, version }] };
  download.mockResolvedValueOnce(Response.json(value));
  const firstRead = await reads.loadEditableSavedShops();
  expect(firstRead).toMatchObject({ status: "fresh", value });
  expect(download.mock.calls[0][0]).toBe(origin + "/v1/me/saved-shops?includeVersions=true");
  expect([...cache.keys()]).toEqual(["fixture-scope-one\0/v1/me/saved-shops?includeVersions=true"]);

  download.mockRejectedValue(new Error("Offline"));
  expect(await reads.loadEditableSavedShops()).toEqual({ ...firstRead, status: "cached" });
  expect(await reads.loadSavedShops()).toEqual({ status: "unavailable" });
});

test("rejects missing, repeated, mismatched and malformed saved-shop versions", async () => {
  const { download, cache, start } = setup();
  const reads = start();
  const shops = [{ id: "one", name: "One" }, { id: "two", name: "Two" }];
  const version = "1:fa91641f-d265-4a3b-9695-4ff553ab5138";
  const known = { shopId: "one", version };
  for (const versions of [
    undefined, [known], [known, known], [known, { shopId: "another", version }], [known, { shopId: "two", version: 1 }],
  ]) {
    download.mockResolvedValueOnce(Response.json({ shops, versions }));
    await expect(reads.loadEditableSavedShops()).rejects.toThrow("unreadable");
  }
  expect(cache.size).toBe(0);
});

test("keeps the checked catalog version with an exact offline hit without changing legacy lookup", async () => {
  const { download, cache, start } = setup();
  const reads = start();
  const product = { id: "oats", name: "Oats", barcode: "00012345678905" };
  download.mockResolvedValueOnce(Response.json({ product }, { headers: { ETag: '"2"' } }));
  const loaded = await reads.findEditableProductByBarcode(product.barcode);
  expect(loaded).toMatchObject({ status: "fresh", value: { product, version: 2 } });
  expect([...cache.keys()]).toEqual(["fixture-scope-one\0/v1/products?gtin=00012345678905\0versioned"]);
  download.mockRejectedValueOnce(Error("Offline"));
  expect(await reads.findEditableProductByBarcode(product.barcode)).toEqual({ ...loaded, status: "cached" });
  download.mockRejectedValueOnce(Error("Offline"));
  expect(await reads.findProductByBarcode(product.barcode)).toEqual({ status: "unavailable" });
  download.mockResolvedValueOnce(Response.json({ product, version: 3 }));
  await expect(reads.findEditableProductById(product.id)).rejects.toThrow("unreadable");
  download.mockResolvedValueOnce(Response.json({ product: null }));
  expect(await reads.findEditableProductByBarcode(product.barcode)).toMatchObject({ status: "fresh", value: { product: null } });
  expect(cache.size).toBe(0);
});

test("preserves a cleared comparison preference and its version in the enrolled cache", async () => {
  const { download, start } = setup();
  const reads = start();
  download.mockResolvedValueOnce(Response.json({ basis: null }, { headers: { ETag: '"3"' } }));
  const checked = await reads.loadComparisonPreference("dry rice");
  expect(checked).toMatchObject({ status: "fresh", value: { basis: null, version: 3 } });
  expect(download.mock.calls[0][0]).toBe(origin + "/v1/me/comparison-preferences/dry%20rice");
  download.mockRejectedValueOnce(Error("Offline"));
  expect(await reads.loadComparisonPreference("dry rice")).toEqual({ ...checked, status: "cached" });
  download.mockResolvedValueOnce(Response.json({ basis: "kg" }, { headers: { ETag: '"0"' } }));
  await expect(reads.loadComparisonPreference("dry rice")).rejects.toThrow("unreadable");
});
