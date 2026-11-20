import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { planShoppingImport } from './shopping-import-plan.ts';

type Photo = Awaited<ReturnType<typeof planShoppingImport>>['photos'][number];

async function verifyPhoto(path: string, expected: Photo) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.size !== expected.bytes) throw new Error('Price photo size does not match the backup.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== expected.sha256) throw new Error('Price photo hash does not match the backup.');
}

async function syncPath(path: string) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Publish immutable JPEG bytes into an operator-provided private local directory. */
export async function localImportPhotos(backupDirectory: string, assetDirectory: string) {
  const input = await realpath(backupDirectory);
  const output = await realpath(assetDirectory);
  const directory = await lstat(output);
  const insideBackup = relative(input, output);
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 ||
      !insideBackup || (insideBackup !== '..' && !insideBackup.startsWith('../'))) {
    throw new Error('Use a private asset directory outside the extracted backup.');
  }

  return async (photo: Photo): Promise<string> => {
    const key = `${photo.sha256}.jpg`;
    const source = join(input, photo.path);
    const destination = join(output, key);
    if (await realpath(source) !== source) throw new Error('A source photo moved after the backup was checked.');

    const staging = await mkdtemp(join(output, '.import-'));
    try {
      const candidate = join(staging, key);
      await copyFile(source, candidate, constants.COPYFILE_EXCL);
      await chmod(candidate, 0o600);
      await verifyPhoto(candidate, photo);
      await syncPath(candidate);
      try {
        await link(candidate, destination);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      }
      await verifyPhoto(destination, photo);
      await syncPath(output);
      return key;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  };
}
