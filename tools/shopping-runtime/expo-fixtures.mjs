import * as fs from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

// Separate Node temp directories stand in for each device’s private files.
export const device = new AsyncLocalStorage();
const pathOf = path => typeof path === 'object' ? path.path : path.startsWith('file:') ? fileURLToPath(path) : path;
export const Paths = {
  get document() { return join(device.getStore(), 'documents'); },
  get cache() { return join(device.getStore(), 'cache'); },
};
class Entry {
  constructor(root, ...name) { this.path = join(pathOf(root), ...name); }
  get uri() { return pathToFileURL(this.path).href; }
  get name() { return basename(this.path); }
  get exists() { return fs.existsSync(this.path); }
  delete() { fs.rmSync(this.path, { recursive: this instanceof Directory, force: true }); }
}
export class File extends Entry {
  get size() { return this.exists ? fs.statSync(this.path).size : 0; }
  async bytes() { return Uint8Array.from(await fs.promises.readFile(this.path)); }
  async text() { return fs.promises.readFile(this.path, 'utf8'); }
  write(value) { fs.writeFileSync(this.path, value); }
  copy(target) { fs.copyFileSync(this.path, target.path, fs.constants.COPYFILE_EXCL); }
  move(target, { overwrite = false } = {}) {
    if (!overwrite && target.exists) throw Error('Destination exists');
    fs.renameSync(this.path, target.path);
    this.path = target.path;
  }
}
export class Directory extends Entry {
  create({ intermediates = false, idempotent = false } = {}) {
    if (this.exists && idempotent) return;
    fs.mkdirSync(this.path, { recursive: intermediates });
  }
  list() {
    return fs.readdirSync(this.path, { withFileTypes: true })
      .map(entry => new (entry.isDirectory() ? Directory : File)(this, entry.name));
  }
}
export { randomUUID };
export const getRandomBytes = size => randomBytes(size);
export const CryptoDigestAlgorithm = { SHA256: 'sha256' };
export async function digest(algorithm, bytes) {
  return Uint8Array.from(createHash(algorithm).update(bytes).digest()).buffer;
}
export async function digestStringAsync(algorithm, value) {
  return createHash(algorithm).update(value).digest('hex');
}
let objectTransport;

export function configureObjectTransport(transport) {
  objectTransport = transport;
}

export function fetch(url, init) {
  if (!objectTransport) throw Error('No local evidence fixture is configured.');
  return objectTransport(url, init);
}
