import { createCheapoAccess } from "../lib/cheapo-access/client";
import { createCheapoShoppingReads } from "../data/cheapo-shopping-reads";

const origin = "https://cheapo.example";
const first = `cheapo_${"A".repeat(43)}`;
const second = `cheapo_${"B".repeat(43)}`;

function setup() {
  let enrollment: string | null = JSON.stringify({ origin, credential: first });
  const protectedStorage = {
    getItem: async () => enrollment,
    setItem: async (_key: string, value: string) => { enrollment = value; },
    deleteItem: async () => { enrollment = null; },
  };
  const download = jest.fn<Promise<Response>, [string, RequestInit]>();
  const cache = new Map<string, string>();
  const snapshot = {
    async read(key: string) { return cache.get(key) ?? null; },
    async write(key: string, text: string) { cache.set(key, text); },
    async remove(key: string) { cache.delete(key); },
  };
  const access = createCheapoAccess(origin, protectedStorage, download,
    async (key: string) => key.endsWith(first) ? "fixture-scope-one" : "fixture-scope-two");
  const start = () => createCheapoShoppingReads(access.openReadSession, snapshot);
  return { access, download, cache, start };
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
  download.mockResolvedValueOnce(Response.json({ basis: null }));
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

  download.mockResolvedValueOnce(Response.json({ basis: null }));
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
