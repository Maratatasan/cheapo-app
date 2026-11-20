import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

// Only downloaded, replaceable shopping snapshots belong in this directory.
const cacheDirectory = () => new Directory(Paths.cache, "cheapo-shopping-snapshots");
let ongoing: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = ongoing.then(operation);
  ongoing = result.catch(() => {});
  return result;
}

async function cacheFile(directory: Directory, key: string): Promise<File> {
  const name = await digestStringAsync(CryptoDigestAlgorithm.SHA256, key);
  return new File(directory, `${name}.json`);
}

export const cheapoShoppingReadCache = {
  read(key: string): Promise<string | null> {
    return serialize(async () => {
      const file = await cacheFile(cacheDirectory(), key);
      return file.exists ? file.text() : null;
    });
  },
  write(key: string, text: string): Promise<void> {
    return serialize(async () => {
      const directory = cacheDirectory();
      const file = await cacheFile(directory, key);
      const draft = new File(directory, `${file.name}.pending`);
      directory.create({ intermediates: true, idempotent: true });
      try {
        await draft.write(text);
        await draft.move(file, { overwrite: true });
      } finally {
        if (draft.uri !== file.uri && draft.exists) draft.delete();
      }
    });
  },
  remove(key: string): Promise<void> {
    return serialize(async () => {
      const file = await cacheFile(cacheDirectory(), key);
      if (file.exists) file.delete();
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
    return serialize(() => {
      const directory = cacheDirectory();
      if (directory.exists) directory.delete();
    });
  },
};
