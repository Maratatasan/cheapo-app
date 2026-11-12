const storageKey = 'cheapo.saved-shops';

export async function readShopSnapshot(): Promise<string | null> {
  return globalThis.localStorage.getItem(storageKey);
}

export async function writeShopSnapshot(contents: string): Promise<void> {
  globalThis.localStorage.setItem(storageKey, contents);
}
