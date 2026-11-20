import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { parseCheapoApiOrigin } from '../lib/cheapo-access/origin';
import { type PhotoAsset, type SavedPriceRecord, isSavedPriceRecord, savedPhotoDirectory } from './local-photo';
import { reviewComplete } from './photo-review';

export type PriceQueueOwner = { origin: string; householdId: string; shopperId: string };
export type PriceAppendReceipt = { id: string; sourceId: string; version: number };
type PriceQueueEntry = { record: SavedPriceRecord; receipt?: PriceAppendReceipt };
type RecoveryEntry = { sourceId: string; reason: 'unfinished' | 'unreadable' };
type PriceAppendResult = { outcome: 'acknowledged'; receipt: PriceAppendReceipt } | { outcome: 'blocked' | 'failed' };
const localId = /^[A-Za-z0-9_-]{1,128}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function ownerKey(owner: PriceQueueOwner) {
  return JSON.stringify([owner.origin, owner.householdId, owner.shopperId]);
}

function validReceipt(value: unknown, sourceId: string): value is PriceAppendReceipt {
  if (!value || typeof value !== 'object') return false;
  const { id, sourceId: confirmedSourceId, version } = value as Partial<PriceAppendReceipt>;
  return typeof id === 'string' && uuid.test(id) && confirmedSourceId === sourceId
    && typeof version === 'number' && Number.isSafeInteger(version) && version > 0;
}

function requirePriceRecord(value: unknown): SavedPriceRecord {
  if (!isSavedPriceRecord(value) || !localId.test(value.id) || !value.shop || !value.review
    || !reviewComplete(value.review, value.shop.displayName)) {
    throw Error('A reviewed price and saved shop are required.');
  }
  const { id, capturedAt, productId, shop, review, original, selected, cropBox } = value;
  const { productName, productType, brand, variety, price, currency, packSize, unitPrice, unit } = review;
  const record = {
    id, capturedAt,
    shop: { id: shop.id, displayName: shop.displayName },
    review: { productName, productType, brand, variety, price, currency, packSize, unitPrice, unit, shop: review.shop },
  };
  if (!original) return { ...record, productId: value.productId };

  const directory = savedPhotoDirectory();
  function protectedPhoto(asset: PhotoAsset, filename: string): PhotoAsset {
    const file = new File(directory, filename);
    if (file.uri !== asset.uri || !file.exists || file.size <= 0) {
      throw Error('Keep evidence in protected price photo storage before queueing a price.');
    }
    return { uri: file.uri, size: file.size, width: asset.width, height: asset.height, mimeType: asset.mimeType };
  }
  const savedOriginal = protectedPhoto(original, `${id}-original.jpg`);
  const selectedName = selected.uri.split('/').pop() ?? '';
  const selectedPrefix = `${id}-selected-`;
  if (selected.uri !== original.uri && (!selectedName.startsWith(selectedPrefix)
    || !/^\d+\.jpg$/.test(selectedName.slice(selectedPrefix.length)))) {
    throw Error('Keep the selected photo in protected price photo storage.');
  }
  const savedSelected = selected.uri === original.uri
    ? savedOriginal
    : protectedPhoto(selected, selectedName);
  return {
    ...record, productId, original: savedOriginal, selected: savedSelected,
    ...(cropBox ? { cropBox: { left: cropBox.left, top: cropBox.top, right: cropBox.right, bottom: cropBox.bottom } } : {}),
  };
}

async function readFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

// Native local-file moves use a same-filesystem rename. Serialize publication
// across store instances as native existence checks and moves are separate.
let pendingPublication: Promise<unknown> = Promise.resolve();
function serializePublication<T>(operation: () => Promise<T>) {
  const result = pendingPublication.then(operation);
  pendingPublication = result.catch(() => {});
  return result;
}

export async function openPriceAppendQueue(input: PriceQueueOwner) {
  const origin = parseCheapoApiOrigin(input.origin);
  if (!origin || typeof input.householdId !== 'string' || typeof input.shopperId !== 'string'
    || !uuid.test(input.householdId) || !uuid.test(input.shopperId)) throw Error('Invalid price queue owner.');
  const owner = Object.freeze({ origin, householdId: input.householdId, shopperId: input.shopperId });
  const scope = await digestStringAsync(CryptoDigestAlgorithm.SHA256, ownerKey(owner));
  const directory = new Directory(new Directory(Paths.document, 'cheapo-price-outbox-v1'), scope);
  const priceFile = (id: string) => new File(directory, `${id}.price.json`);
  const receiptFile = (id: string) => new File(directory, `${id}.receipt.json`);

  async function publish(file: File, text: string) {
    directory.create({ intermediates: true, idempotent: true });
    const staged = new File(directory, `${file.name}.${randomUUID()}.pending`);
    await staged.write(text);
    await staged.move(file, { overwrite: false });
  }

  async function readPrice(file: File, sourceId: string) {
    const value = await readFile(file);
    if (!value || typeof value !== 'object' || !('owner' in value) || !('record' in value)
      || JSON.stringify(value.owner) !== JSON.stringify(owner)) throw Error('The queued price owner is invalid.');
    const record = requirePriceRecord(value.record);
    if (record.id !== sourceId) throw Error('The queued price ID does not match.');
    return record;
  }

  return {
    owner,
    async save(value: SavedPriceRecord) {
      // Freeze a data copy before awaiting anything so edits to a screen model
      // cannot change a retry's reviewed price.
      const record = requirePriceRecord(value);
      return serializePublication(async () => {
        const file = priceFile(record.id);
        if (file.exists) {
          if (JSON.stringify(await readPrice(file, record.id)) !== JSON.stringify(record)) {
            throw Error('A different price is already queued with this ID.');
          }
          return;
        }
        await publish(file, JSON.stringify({ owner, record }));
      });
    },
    async read() {
      await pendingPublication;
      const entries: PriceQueueEntry[] = [];
      const recovery: RecoveryEntry[] = [];
      if (!directory.exists) return { entries, recovery };
      for (const file of directory.list()) {
        const price = /^([A-Za-z0-9_-]{1,128})\.price\.json$/.exec(file.name);
        const receipt = /^([A-Za-z0-9_-]{1,128})\.receipt\.json$/.exec(file.name);
        const staged = /^(([A-Za-z0-9_-]{1,128})\.(?:price|receipt)\.json)\.[\w-]+\.pending$/.exec(file.name);
        if (staged) {
          try {
            const committed = new File(directory, staged[1]);
            if (file instanceof File && committed.exists && await file.text() === await committed.text()) continue;
          } catch {
            // Report the unfinished file and keep its contents available for recovery.
          }
          recovery.push({ sourceId: staged[2], reason: 'unfinished' });
        } else if (receipt && !priceFile(receipt[1]).exists) {
          recovery.push({ sourceId: receipt[1], reason: 'unreadable' });
        } else if (price) {
          const sourceId = price[1];
          try {
            if (!(file instanceof File)) throw Error('The queued price is not a file.');
            const record = await readPrice(file, sourceId);
            const accepted = receiptFile(sourceId);
            if (!accepted.exists) entries.push({ record });
            else {
              const receiptValue = await readFile(accepted);
              if (!validReceipt(receiptValue, sourceId)) throw Error('Unreadable price acknowledgement.');
              entries.push({ record, receipt: receiptValue });
            }
          } catch {
            recovery.push({ sourceId, reason: 'unreadable' });
          }
        }
      }
      return { entries, recovery };
    },
    acknowledge(sourceId: string, receipt: PriceAppendReceipt) {
      if (!localId.test(sourceId) || !validReceipt(receipt, sourceId)) throw Error('Invalid price acknowledgement.');
      const text = JSON.stringify({ id: receipt.id, sourceId, version: receipt.version });
      return serializePublication(async () => {
        await readPrice(priceFile(sourceId), sourceId);
        const file = receiptFile(sourceId);
        if (file.exists) {
          if (await file.text() !== text) throw Error('A different price acknowledgement was already saved.');
          return;
        }
        await publish(file, text);
      });
    },
  };
}

type PriceAppendQueue = Awaited<ReturnType<typeof openPriceAppendQueue>>;
type PriceAppendSession = {
  owner: PriceQueueOwner;
  send(record: SavedPriceRecord): Promise<PriceAppendResult>;
};

export async function syncPriceAppends(queue: PriceAppendQueue, session: PriceAppendSession) {
  if (ownerKey(queue.owner) !== ownerKey(session.owner)) return 'blocked';
  const { entries, recovery } = await queue.read();
  let failed = false;
  for (const entry of entries) {
    if (entry.receipt) continue;
    try {
      const result = await session.send(entry.record);
      if (result.outcome === 'blocked') return 'blocked';
      if (result.outcome === 'acknowledged') await queue.acknowledge(entry.record.id, result.receipt);
      else failed = true;
    } catch {
      // A timeout or interrupted acknowledgement leaves the original intent.
      failed = true;
    }
  }
  if (failed || (recovery.length && (await queue.read()).recovery.length)) return 'failed';
  return 'complete';
}
