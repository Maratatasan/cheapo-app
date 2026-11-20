import { cheapoPricePhotoCache, cheapoShoppingReadCache } from "../data/cheapo-shopping-read-cache";

const mockFiles = new Map<string, string | Uint8Array>();
const mockDirectories = new Set<string>();
const base = "file:///cache/cheapo-shopping-snapshots";

jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    jest.requireActual<typeof import("node:crypto")>("node:crypto").createHash("sha256").update(value).digest("hex"),
}));

jest.mock("expo-file-system", () => {
  class File {
    uri: string;

    constructor(parent: Directory | string, name?: string) {
      this.uri = typeof parent === "string" ? parent : `${parent.uri}/${name}`;
    }

    get name() { return this.uri.split("/").at(-1)!; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return Buffer.byteLength(mockFiles.get(this.uri) ?? ""); }
    async text() { return mockFiles.get(this.uri) as string; }
    write(contents: string | Uint8Array) { mockFiles.set(this.uri, contents); }
    delete() { mockFiles.delete(this.uri); }
    async move(destination: File) {
      mockFiles.set(destination.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
      this.uri = destination.uri;
    }
  }

  class Directory {
    uri: string;

    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    get exists() { return mockDirectories.has(this.uri); }
    create() { mockDirectories.add(this.uri); }
    list() {
      return [...mockFiles.keys()].filter(uri => uri.startsWith(`${this.uri}/`)).map(uri => new File(uri));
    }
    delete() {
      for (const entry of this.list()) entry.delete();
      mockDirectories.delete(this.uri);
    }
  }

  return { Directory, File, Paths: { cache: "file:///cache" } };
});

beforeEach(() => {
  mockFiles.clear();
  mockDirectories.clear();
});

test("measures downloaded UTF-8 snapshot bytes and clears only its owned directory", async () => {
  const protectedPaths = [
    "file:///documents/saved-shops/shops-1.json",
    "file:///documents/price-photos/receipt.jpg",
    "file:///documents/cheapo-outbox/pending.json",
    "file:///cache/cheapo-shopping-exports/private.zip",
  ];
  for (const path of protectedPaths) mockFiles.set(path, "protected fixture");

  expect(await cheapoShoppingReadCache.measureBytes()).toBe(0);
  await cheapoShoppingReadCache.write("scope\0/v1/me/saved-shops", '{"name":"Café"}');
  expect(await cheapoShoppingReadCache.read("scope\0/v1/me/saved-shops")).toBe('{"name":"Café"}');
  expect(await cheapoShoppingReadCache.measureBytes()).toBe(Buffer.byteLength('{"name":"Café"}'));
  expect([...mockFiles.keys()].filter(path => path.startsWith(base))).toHaveLength(1);

  await cheapoShoppingReadCache.clear();
  expect(await cheapoShoppingReadCache.measureBytes()).toBe(0);
  expect(await cheapoShoppingReadCache.read("scope\0/v1/me/saved-shops")).toBeNull();
  expect([...mockFiles.keys()]).toEqual(protectedPaths);
});

test("measures and clears only downloaded image copies, and ignores missing files or old cache writes", async () => {
  const protectedPaths = [
    "file:///documents/price-photos/original.jpg",
    "file:///documents/price-photos/selected.jpg",
    "file:///documents/cheapo-outbox/pending.json",
    "file:///documents/cheapo-outbox/upload-plan.json",
  ];
  for (const path of protectedPaths) mockFiles.set(path, "protected fixture");
  const key = "enrollment-scope\0/v1/me/price-observations/id/photos/crop";
  const bytes = new Uint8Array([255, 216, 1, 255, 217]);
  const metadata = { sha256: "a".repeat(64), width: 400, height: 300, byteCount: bytes.length, lastSyncedAt: "2026-01-02T10:00:00.000Z" };
  const revision = cheapoPricePhotoCache.revision();
  const first = await cheapoPricePhotoCache.write(key, revision, metadata, bytes);
  expect(first?.uri.startsWith(base)).toBe(true);
  expect(await cheapoShoppingReadCache.measureBytes()).toBe(bytes.byteLength + Buffer.byteLength(JSON.stringify(metadata)));
  expect(await cheapoPricePhotoCache.read(key, revision)).toEqual(first);
  mockFiles.delete(first!.uri);
  expect(await cheapoPricePhotoCache.read(key, revision)).toBeNull();
  await cheapoPricePhotoCache.write(key, revision, metadata, bytes);

  await cheapoShoppingReadCache.clear();
  expect(await cheapoPricePhotoCache.read(key, cheapoPricePhotoCache.revision())).toBeNull();
  expect(await cheapoPricePhotoCache.write(key, revision, metadata, bytes)).toBeNull();
  expect(await cheapoShoppingReadCache.measureBytes()).toBe(0);
  expect([...mockFiles.keys()]).toEqual(protectedPaths);
});

test('an earlier JSON response cannot restore or delete a snapshot after Clear cache', async () => {
  const key = 'shopping-scope\0/v1/me/saved-shops';
  const old = cheapoShoppingReadCache.revision();
  await cheapoShoppingReadCache.write(key, 'before clear', old);
  const observe = jest.fn();
  const unsubscribe = cheapoShoppingReadCache.subscribeClear(observe);
  await cheapoShoppingReadCache.clear();
  expect(observe).toHaveBeenCalledTimes(1);
  unsubscribe();
  await cheapoShoppingReadCache.write(key, 'stale result', old);
  expect(await cheapoShoppingReadCache.read(key)).toBeNull();
  await cheapoShoppingReadCache.write(key, 'current result');
  await cheapoShoppingReadCache.remove(key, old);
  expect(await cheapoShoppingReadCache.read(key, old)).toBeNull();
  expect(await cheapoShoppingReadCache.read(key)).toBe('current result');
});

test('a delayed presentation photo response cannot replace or remove a newer cached version', async () => {
  const key = 'enrolled-scope\0/v1/products/exact-fixture/presentation-photo';
  const bytes = new Uint8Array([255, 216, 1, 255, 217]);
  const prior = { version: 1, sha256: 'a'.repeat(64), width: 80, height: 60, byteCount: bytes.length,
    lastSyncedAt: '2026-01-02T10:00:00.000Z' };
  const current = { ...prior, version: 2, sha256: 'b'.repeat(64) };
  const revision = cheapoPricePhotoCache.revision();
  const saved = await cheapoPricePhotoCache.write(key, revision, current, bytes);
  expect(saved?.version).toBe(2);
  expect(await cheapoPricePhotoCache.write(key, revision, prior, bytes)).toBeNull();
  await cheapoPricePhotoCache.remove(key, revision, 1);
  expect(await cheapoPricePhotoCache.read(key, revision)).toEqual(saved);
  await cheapoPricePhotoCache.remove(key, revision, 2);
  expect(await cheapoPricePhotoCache.read(key, revision)).toBeNull();
});
