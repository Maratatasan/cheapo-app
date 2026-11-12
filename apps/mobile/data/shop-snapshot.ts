import { Directory, File, Paths } from 'expo-file-system';

function shopDirectory(): Directory {
  return new Directory(Paths.document, 'saved-shops');
}

function latestSnapshot(directory: Directory): { marker: Directory; revision: number } | undefined {
  if (!directory.exists) return undefined;

  let latest: { marker: Directory; revision: number } | undefined;
  for (const entry of directory.list()) {
    const match = /^shops-(\d+)\.committed$/.exec(entry.name);
    if (!match) continue;
    const revision = Number(match[1]);
    if (!(entry instanceof Directory) || !Number.isSafeInteger(revision)) {
      throw new Error('Invalid shop snapshot entry.');
    }
    if (!latest || latest.revision < revision) latest = { marker: entry, revision };
  }
  return latest;
}

export async function readShopSnapshot(): Promise<string | null> {
  const directory = shopDirectory();
  const latest = latestSnapshot(directory);
  return latest ? new File(directory, `shops-${latest.revision}.json`).text() : null;
}

export async function writeShopSnapshot(contents: string): Promise<void> {
  const directory = shopDirectory();
  const previous = latestSnapshot(directory);
  const revision = (previous?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new Error('Shop snapshot revision limit reached.');

  directory.create({ intermediates: true, idempotent: true });
  // A revision becomes visible only after its file is written and its marker
  // directory is created. A failed publication leaves the previous revision readable.
  await new File(directory, `shops-${revision}.json`).write(contents);
  new Directory(directory, `shops-${revision}.committed`).create();

  try {
    if (previous) {
      previous.marker.delete();
      new File(directory, `shops-${previous.revision}.json`).delete();
    }
  } catch {
    // The new snapshot is already committed. An older file can be left in place.
  }
}
