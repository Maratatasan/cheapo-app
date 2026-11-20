import { cheapoShoppingReadCache } from "../data/cheapo-shopping-read-cache";

const mockFiles = new Map<string, string>();
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
    get size() { return Buffer.byteLength(mockFiles.get(this.uri) ?? "", "utf8"); }
    async text() { return mockFiles.get(this.uri)!; }
    write(text: string) { mockFiles.set(this.uri, text); }
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
