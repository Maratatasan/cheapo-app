import { priceAppendSchema } from '@cheapo/domain/price-append';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { parseCheapoApiOrigin } from '../lib/cheapo-access/origin';
import { type DraftShop, type LocalPhotoDraft, type PhotoAsset, type SavedPriceRecord, isSavedPriceRecord, savedPhotoDirectory } from './local-photo';
import { readQueueBackupFiles } from './queue-backup-files';
import { reviewComplete, reviewUnitPrice } from './photo-review';
import { createPriceEvidenceStore } from './price-evidence-queue';

export type PriceQueueOwner = { origin: string; householdId: string; shopperId: string };
export type PriceAppendReceipt = { id: string; sourceId: string; version: number; deriveCropFromOriginal?: true };
type PriceQueueEntry = { record: SavedPriceRecord; body?: string; receipt?: PriceAppendReceipt; needsShop?: true };
type RecoveryEntry = { sourceId: string; reason: 'unfinished' | 'unreadable' };
type FailurePhase = 'price' | 'photo';
const backupFileName = /^[A-Za-z0-9_-]{1,128}\.(?:(?:price|receipt|needs-shop|evidence|(?:original|crop)\.evidence-available)\.json|(?:price|photo)\.sync-failed)(?:\.[\w-]+\.pending)?$/;
const localId = /^[A-Za-z0-9_-]{1,128}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function ownerKey(owner: PriceQueueOwner) {
  return JSON.stringify([owner.origin, owner.householdId, owner.shopperId]);
}

export function sameShoppingOwner(first: PriceQueueOwner | null, second: PriceQueueOwner) {
  return first !== null && first.origin === second.origin
    && first.householdId === second.householdId && first.shopperId === second.shopperId;
}

function validReceipt(value: unknown, sourceId: string): value is PriceAppendReceipt {
  if (!value || typeof value !== 'object') return false;
  const { id, sourceId: confirmedSourceId, version, deriveCropFromOriginal } = value as Partial<PriceAppendReceipt>;
  return typeof id === 'string' && uuid.test(id) && confirmedSourceId === sourceId
    && typeof version === 'number' && Number.isSafeInteger(version) && version > 0
    && (deriveCropFromOriginal === undefined || deriveCropFromOriginal === true);
}

function requirePriceRecord(value: unknown, needsShop = false): SavedPriceRecord {
  if (!isSavedPriceRecord(value) || !localId.test(value.id) || !value.review
    || !reviewComplete(value.review, value.shop?.displayName) || (needsShop ? value.shop || !value.original : !value.shop)) {
    throw Error('A reviewed price and saved shop are required.');
  }
  const { id, capturedAt, productId, shop, review, original, selected, cropBox } = value;
  const { productName, productType, brand, variety, price, currency, packSize, unitPrice, unit } = review;
  const record = {
    id, capturedAt,
    ...(shop ? { shop: { id: shop.id, displayName: shop.displayName } } : {}),
    review: { productName, productType, brand, variety, price, currency, packSize, unitPrice, unit, shop: review.shop },
  };
  if (!original) return { ...record, shop: value.shop, productId: value.productId };

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

function encodePriceAppend({ id, capturedAt, productId, shop, review, cropBox }: SavedPriceRecord) {
  if (!shop || !review) throw Error('A reviewed price and saved shop are required.');
  const { productName, productType, brand, variety, price, currency, packSize, unitPrice, unit } = review;
  const payload = priceAppendSchema.safeParse({
    sourceId: id, capturedAt, productId, shopId: shop.id, shopDisplayName: shop.displayName,
    review: { productName, productType, brand, variety, price, currency, packSize,
      unitPrice: unitPrice.trim() || undefined, unit: unit.trim() || undefined },
    unitPrice: reviewUnitPrice(review),
    cropBox,
  });
  if (!payload.success) throw Error('This reviewed price cannot be queued for Cheapo. Check its details.');
  return JSON.stringify(payload.data);
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

export function priceQueueRoot() {
  return new Directory(Paths.document, 'cheapo-price-outbox-v1');
}

export async function openPriceAppendQueue(input: PriceQueueOwner) {
  const origin = parseCheapoApiOrigin(input.origin);
  if (!origin || typeof input.householdId !== 'string' || typeof input.shopperId !== 'string'
    || !uuid.test(input.householdId) || !uuid.test(input.shopperId)) throw Error('Invalid price queue owner.');
  const owner = Object.freeze({ origin, householdId: input.householdId, shopperId: input.shopperId });
  const scope = await digestStringAsync(CryptoDigestAlgorithm.SHA256, ownerKey(owner));
  const directory = new Directory(priceQueueRoot(), scope);
  const priceFile = (id: string) => new File(directory, `${id}.price.json`);
  const receiptFile = (id: string) => new File(directory, `${id}.receipt.json`);
  function needsShopFile(id: string) {
    if (!localId.test(id)) throw Error('Invalid pending price ID.');
    return new File(directory, `${id}.needs-shop.json`);
  }

  async function publish(file: File, text: string) {
    directory.create({ intermediates: true, idempotent: true });
    const staged = new File(directory, `${file.name}.${randomUUID()}.pending`);
    await staged.write(text);
    await staged.move(file, { overwrite: false });
  }

  function failureFile(sourceId: string, phase: FailurePhase) {
    if (!localId.test(sourceId)) throw Error('Invalid pending price ID.');
    return new File(directory, `${sourceId}.${phase}.sync-failed`);
  }

  async function readEnvelope(file: File, sourceId: string, needsShop = false) {
    const value = await readFile(file);
    if (!value || typeof value !== 'object' || !('owner' in value) || !('record' in value)
      || JSON.stringify(value.owner) !== JSON.stringify(owner)) throw Error('The queued price owner is invalid.');
    if (needsShop && (!('format' in value) || value.format !== 1)) throw Error('Unknown pending shop format.');
    const record = requirePriceRecord(value.record, needsShop);
    if (record.id !== sourceId) throw Error('The queued price ID does not match.');
    return { record, value };
  }

  async function readPrice(file: File, sourceId: string) {
    const { record, value } = await readEnvelope(file, sourceId);
    if (!('format' in value) || value.format !== 1 || !('body' in value) || typeof value.body !== 'string') {
      return { record };
    }
    try {
      const payload = priceAppendSchema.safeParse(JSON.parse(value.body));
      if (payload.success && payload.data.sourceId === sourceId) return { record, body: value.body };
    } catch {
      // A valid saved price remains available even if its request is damaged.
    }
    return { record };
  }

  function publishPrice(record: SavedPriceRecord) {
    return publish(priceFile(record.id), JSON.stringify({ format: 1, owner, record, body: encodePriceAppend(record) }));
  }

  async function readEntries() {
    const entries: PriceQueueEntry[] = [];
    const recovery: RecoveryEntry[] = [];
    if (!directory.exists) return { entries, recovery };
    for (const file of directory.list()) {
      const price = /^([A-Za-z0-9_-]{1,128})\.price\.json$/.exec(file.name);
      const receipt = /^([A-Za-z0-9_-]{1,128})\.receipt\.json$/.exec(file.name);
      const needsShop = /^([A-Za-z0-9_-]{1,128})\.needs-shop\.json$/.exec(file.name);
      const staged = /^(([A-Za-z0-9_-]{1,128})\.(?:price|receipt|needs-shop)\.json)\.[\w-]+\.pending$/.exec(file.name);
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
      } else if (needsShop && !priceFile(needsShop[1]).exists) {
        const sourceId = needsShop[1];
        try {
          if (!(file instanceof File)) throw Error('The queued price is not a file.');
          const { record } = await readEnvelope(file, sourceId, true);
          entries.push({ record, needsShop: true });
        } catch {
          recovery.push({ sourceId, reason: 'unreadable' });
        }
      } else if (price) {
        const sourceId = price[1];
        let record: SavedPriceRecord | undefined;
        try {
          if (!(file instanceof File)) throw Error('The queued price is not a file.');
          const pending = await readPrice(file, sourceId);
          record = pending.record;
          if (!pending.body) throw Error('Unreadable price request.');
          const accepted = receiptFile(sourceId);
          if (!accepted.exists) entries.push(pending);
          else {
            const receiptValue = await readFile(accepted);
            if (!validReceipt(receiptValue, sourceId)) throw Error('Unreadable price acknowledgement.');
            entries.push({ ...pending, receipt: receiptValue });
          }
        } catch {
          if (record) entries.push({ record });
          recovery.push({ sourceId, reason: 'unreadable' });
        }
      }
    }
    return { entries, recovery };
  }

  return {
    owner,
    markFailed(sourceId: string, phase: FailurePhase) {
      return serializePublication(async () => {
        const marker = failureFile(sourceId, phase);
        if (!marker.exists) await publish(marker, 'failed');
      });
    },
    hasFailed(sourceId: string, phase: FailurePhase) {
      return failureFile(sourceId, phase).exists;
    },
    evidence: createPriceEvidenceStore(directory, (file, text) => serializePublication(async () => {
      if (!file.exists) await publish(file, text);
      else if (await file.text() !== text) throw Error('Different evidence has already been saved for this price.');
    })),
    withProtectedPriceSources<T>(clear: (ids: ReadonlySet<string>) => Promise<T>) {
      return serializePublication(async () => {
        const root = priceQueueRoot();
        const ids = new Set<string>();
        for (const scopeDirectory of root.exists ? root.list() : []) {
          if (!(scopeDirectory instanceof Directory)) throw Error('Could not check protected prices.');
          const files = scopeDirectory.list();
          if (scopeDirectory.name !== scope) {
            if (files.length) throw Error('Another phone enrollment has protected work.');
            continue;
          }
          for (const file of files) {
            if (!(file instanceof File) || !backupFileName.test(file.name)) throw Error('Could not check protected prices.');
            const sourceId = file.name.split('.')[0];
            ids.add(sourceId);
            const envelope = /\.(price|needs-shop)\.json(?:\.[\w-]+\.pending)?$/.exec(file.name);
            if (envelope) await readEnvelope(file, sourceId, envelope[1] === 'needs-shop');
          }
        }
        return clear(ids);
      });
    },
    async save(value: SavedPriceRecord) {
      // Freeze a data copy before awaiting anything so edits to a screen model
      // cannot change a retry's reviewed price.
      const record = requirePriceRecord(value);
      return serializePublication(async () => {
        const file = priceFile(record.id);
        if (file.exists) {
          const previous = await readPrice(file, record.id);
          if (JSON.stringify(previous.record) !== JSON.stringify(record)) {
            throw Error('A different price is already queued with this ID.');
          }
          if (!previous.body) throw Error('The saved price needs sync recovery.');
          return;
        }
        await publishPrice(record);
      });
    },
    saveNeedsShop(value: LocalPhotoDraft) {
      const record = requirePriceRecord(value, true);
      return serializePublication(async () => {
        if (priceFile(record.id).exists) throw Error('This price already has a confirmed shop.');
        const file = needsShopFile(record.id);
        if (file.exists) {
          const previous = await readEnvelope(file, record.id, true);
          if (JSON.stringify(previous.record) !== JSON.stringify(record)) throw Error('A different price is already saved with this ID.');
          return;
        }
        await publish(file, JSON.stringify({ format: 1, owner, record }));
      });
    },
    confirmShop(sourceId: string, shop: DraftShop) {
      const held = needsShopFile(sourceId);
      return serializePublication(async () => {
        const { record } = await readEnvelope(held, sourceId, true);
        const file = priceFile(sourceId);
        if (file.exists) {
          const completed = await readPrice(file, sourceId);
          if (completed.record.shop?.id !== shop.id || !completed.body) throw Error('This price already has a different confirmed shop.');
          return completed.record;
        }
        const confirmed = requirePriceRecord({ ...record, shop, review: { ...record.review, shop: shop.displayName } });
        await publishPrice(confirmed);
        return confirmed;
      });
    },
    async read() {
      await pendingPublication;
      return readEntries();
    },
    backup() {
      return serializePublication(async () => ({
        ...await readEntries(),
        files: await readQueueBackupFiles(directory, backupFileName),
      }));
    },
    acknowledge(sourceId: string, receipt: unknown) {
      if (!localId.test(sourceId) || !validReceipt(receipt, sourceId)) throw Error('Invalid price acknowledgement.');
      const text = JSON.stringify({ id: receipt.id, sourceId, version: receipt.version,
        ...(receipt.deriveCropFromOriginal ? { deriveCropFromOriginal: true } : {}) });
      return serializePublication(async () => {
        const pending = await readPrice(priceFile(sourceId), sourceId);
        if (!pending.body) throw Error('The saved price needs sync recovery.');
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

export type PriceAppendQueue = Awaited<ReturnType<typeof openPriceAppendQueue>>;
