import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import { readPricePhotoMetadata, type PricePhotoCache } from "./cheapo-price-photo-read";

// Only downloaded, replaceable shopping snapshots belong in this directory.
const cacheDirectory = () => new Directory(Paths.cache, "cheapo-shopping-snapshots");
let ongoing: Promise<unknown> = Promise.resolve();
let revision = 0;
const clearListeners = new Set<() => void>();

function serialize<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = ongoing.then(operation);
  ongoing = result.catch(() => {});
  return result;
}

const hashKey = (key: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, key);

async function cacheFile(directory: Directory, key: string): Promise<File> {
  const name = await hashKey(key);
  return new File(directory, `${name}.json`);
}

async function replaceFile(directory: Directory, file: File, contents: string | Uint8Array<ArrayBuffer>) {
  const draft = new File(directory, `${file.name}.pending`);
  directory.create({ intermediates: true, idempotent: true });
  try {
    await draft.write(contents);
    await draft.move(file, { overwrite: true });
  } finally {
    if (draft.uri !== file.uri && draft.exists) draft.delete();
  }
}

export const cheapoShoppingReadCache = {
  revision: () => revision,
  subscribeClear(listener: () => void) {
    clearListeners.add(listener);
    return () => { clearListeners.delete(listener); };
  },
  read(key: string, expectedRevision = revision): Promise<string | null> {
    return serialize(async () => {
      const file = await cacheFile(cacheDirectory(), key);
      if (revision !== expectedRevision || !file.exists) return null;
      const text = await file.text();
      return revision === expectedRevision ? text : null;
    });
  },
  write(key: string, text: string, expectedRevision = revision): Promise<void> {
    return serialize(async () => {
      const directory = cacheDirectory();
      const file = await cacheFile(directory, key);
      if (revision !== expectedRevision) return;
      await replaceFile(directory, file, text);
    });
  },
  remove(key: string, expectedRevision = revision): Promise<void> {
    return serialize(async () => {
      const file = await cacheFile(cacheDirectory(), key);
      if (revision === expectedRevision && file.exists) file.delete();
    });
  },
  measureBytes(): Promise<number> {
    return serialize(() => {
      const directory = cacheDirectory();
      if (!directory.exists) return 0;
      let bytes = 0;
      for (const entry of directory.list()) {
        if (entry instanceof File) bytes += entry.size;
      }
      return bytes;
    });
  },
  clear(): Promise<void> {
    revision += 1;
    const cleared = serialize(() => {
      const directory = cacheDirectory();
      if (directory.exists) directory.delete();
    });
    for (const listener of clearListeners) {
      try { listener(); } catch { /* The storage clear is independent of the view. */ }
    }
    return cleared;
  },
};

async function photoFiles(directory: Directory, key: string) {
  const name = await hashKey(key);
  return {
    metadata: new File(directory, `${name}.photo.json`),
    image: (hash: string) => new File(directory, `${name}.${hash}.jpg`),
  };
}

async function savedMetadata(file: File) {
  try {
    return file.exists ? readPricePhotoMetadata(JSON.parse(await file.text())) : null;
  } catch {
    return null;
  }
}

export const cheapoPricePhotoCache: PricePhotoCache = {
  revision: () => revision,
  read(key, expectedRevision) {
    return serialize(async () => {
      if (revision !== expectedRevision) return null;
      const files = await photoFiles(cacheDirectory(), key);
      const metadata = await savedMetadata(files.metadata);
      if (!metadata || revision !== expectedRevision) return null;
      const image = files.image(metadata.sha256);
      return image.exists && image.size === metadata.byteCount ? { ...metadata, uri: image.uri } : null;
    });
  },
  write(key, expectedRevision, input, bytes) {
    return serialize(async () => {
      const metadata = readPricePhotoMetadata(input);
      if (!metadata || revision !== expectedRevision || bytes.byteLength !== metadata.byteCount) return null;
      const directory = cacheDirectory();
      const files = await photoFiles(directory, key);
      const previous = await savedMetadata(files.metadata);
      if (revision !== expectedRevision) return null;
      if (previous?.version !== undefined && metadata.version !== undefined
        && (previous.version > metadata.version || previous.version === metadata.version
          && (previous.sha256 !== metadata.sha256 || previous.byteCount !== metadata.byteCount
            || previous.width !== metadata.width || previous.height !== metadata.height))) return null;
      const image = files.image(metadata.sha256);
      await replaceFile(directory, image, bytes);
      await replaceFile(directory, files.metadata, JSON.stringify(metadata));
      if (previous && previous.sha256 !== metadata.sha256) {
        const superseded = files.image(previous.sha256);
        if (superseded.exists) superseded.delete();
      }
      return revision === expectedRevision ? { ...metadata, uri: image.uri } : null;
    });
  },
  remove(key, expectedRevision, maxVersion) {
    return serialize(async () => {
      if (revision !== expectedRevision) return;
      const files = await photoFiles(cacheDirectory(), key);
      const metadata = await savedMetadata(files.metadata);
      if (!files.metadata.exists || (maxVersion !== undefined && (metadata?.version ?? 0) > maxVersion)) return;
      files.metadata.delete();
      if (metadata) {
        const image = files.image(metadata.sha256);
        if (image.exists) image.delete();
      }
    });
  },
};
