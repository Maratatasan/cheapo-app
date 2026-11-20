import { priceAppendSchema } from '@cheapo/domain/price-append';
import { productSchema } from '@cheapo/domain';
import { canonicalProductBarcode } from '@cheapo/domain/product-barcode';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import { parseCheapoApiOrigin } from '../lib/cheapo-access/origin';
import { type DraftShop, type LocalPhotoDraft, type PhotoAsset, type SavedPriceRecord, isSavedPriceRecord, savedPhotoDirectory } from './local-photo';
import { readQueueBackupFiles } from './queue-backup-files';
import { reviewComplete, reviewUnitPrice } from './photo-review';
import { createPriceEvidenceStore } from './price-evidence-queue';
import { mutationOperationId } from './shopping-mutations';

export type PriceQueueOwner = { origin: string; householdId: string; shopperId: string };
export type PriceAppendReceipt = { id: string; sourceId: string; version: number; deriveCropFromOriginal?: true };
type PriceQueueEntry = { record: SavedPriceRecord; body?: string; receipt?: PriceAppendReceipt; needsShop?: true };
type RecoveryEntry = { sourceId: string; reason: 'unfinished' | 'unreadable'; confirmedProductTitle?: string };
type FailurePhase = 'price' | 'photo';
export type ProductPriceDraft = {
  record: SavedPriceRecord;
  catalogOperationId: string;
  createdAt: string;
  barcode?: string;
};
export type ProductPriceChoice = { kind: 'add' } | { kind: 'reuse'; productId: string };
const backupFileName = /^[A-Za-z0-9_-]{1,128}\.(?:(?:price|receipt|needs-shop|product-price-draft|product-price-choice|evidence|(?:original|crop)\.evidence-available)\.json|(?:price|photo)\.sync-failed)(?:\.[\w-]+\.pending)?$/;
const productPriceDraftName = /^([A-Za-z0-9_-]{1,128})\.product-price-draft\.json$/;
const productPriceChoiceName = /^([A-Za-z0-9_-]{1,128})\.product-price-choice\.json$/;
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

function requireProductPriceDraft(value: unknown): ProductPriceDraft {
  if (!value || typeof value !== 'object' || !('record' in value) || !('catalogOperationId' in value)
    || !('createdAt' in value)) throw Error('This product draft is unreadable.');
  const { createdAt } = value;
  const parsedDate = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  const operation = mutationOperationId.safeParse(value.catalogOperationId);
  const barcode = 'barcode' in value && typeof value.barcode === 'string' ? canonicalProductBarcode(value.barcode) : undefined;
  const record = requirePriceRecord(value.record);
  if (!record.productId || !operation.success || typeof createdAt !== 'string' || !Number.isFinite(parsedDate)
    || new Date(parsedDate).toISOString() !== createdAt || ('barcode' in value && value.barcode !== undefined && !barcode)) {
    throw Error('This product draft is unreadable.');
  }
  encodePriceAppend(record);
  return { record, catalogOperationId: operation.data, createdAt, ...(barcode ? { barcode } : {}) };
}

function requireProductChoice(value: unknown): ProductPriceChoice {
  if (value && typeof value === 'object' && 'kind' in value) {
    if (value.kind === 'add') return { kind: 'add' };
    if (value.kind === 'reuse' && 'productId' in value) {
      const id = productSchema.shape.id.safeParse(value.productId);
      if (id.success && id.data !== '.' && id.data !== '..' && !id.data.includes('\0')) return { kind: 'reuse', productId: id.data };
    }
  }
  throw Error('Choose the exact product before saving this price.');
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

  function productPriceDraftFile(id: string) {
    if (!localId.test(id)) throw Error('Invalid product draft ID.');
    return new File(directory, `${id}.product-price-draft.json`);
  }

  function productPriceChoiceFile(id: string) {
    if (!localId.test(id)) throw Error('Invalid product draft ID.');
    return new File(directory, `${id}.product-price-choice.json`);
  }

  function hasProductPriceDraft(id: string) {
    const file = productPriceDraftFile(id);
    return file.exists || (directory.exists && directory.list().some(entry =>
      entry.name.startsWith(`${file.name}.`) && entry.name.endsWith('.pending')));
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

  async function readProductPriceDraft(file: File, sourceId: string) {
    const value = await readFile(file);
    if (!value || typeof value !== 'object' || !('owner' in value) || JSON.stringify(value.owner) !== JSON.stringify(owner)
      || !('format' in value) || value.format !== 1 || !('draft' in value)) throw Error('The product draft owner or format is invalid.');
    const draft = requireProductPriceDraft(value.draft);
    if (draft.record.id !== sourceId) throw Error('The product draft ID does not match.');
    return draft;
  }

  async function readChoiceFile(file: File, sourceId: string) {
    const value = await readFile(file);
    if (!value || typeof value !== 'object' || !('owner' in value) || JSON.stringify(value.owner) !== JSON.stringify(owner)
      || !('format' in value) || value.format !== 1 || !('sourceId' in value) || value.sourceId !== sourceId
      || !('choice' in value)) throw Error('The product choice could not be restored.');
    return requireProductChoice(value.choice);
  }

  function writeChoice(file: File, sourceId: string, choice: ProductPriceChoice) {
    return publish(file, JSON.stringify({ format: 1, owner, sourceId, choice }));
  }

  async function restoreProductPriceChoice(sourceId: string, publishRecovered = true) {
    const file = productPriceChoiceFile(sourceId);
    if (file.exists) return readChoiceFile(file, sourceId);
    if (!directory.exists) return;
    let restored: ProductPriceChoice | undefined;
    for (const entry of directory.list()) {
      if (!entry.name.startsWith(`${file.name}.`) || !entry.name.endsWith('.pending')) continue;
      if (!(entry instanceof File)) throw Error('The product choice could not be restored.');
      const choice = await readChoiceFile(entry, sourceId);
      if (restored && JSON.stringify(restored) !== JSON.stringify(choice)) throw Error('The saved product choices conflict.');
      restored = choice;
    }
    if (restored && publishRecovered) await writeChoice(file, sourceId, restored);
    return restored;
  }

  function publishPrice(record: SavedPriceRecord) {
    return publish(priceFile(record.id), JSON.stringify({ format: 1, owner, record, body: encodePriceAppend(record) }));
  }

  async function readEntries() {
    const entries: PriceQueueEntry[] = [];
    const recovery: RecoveryEntry[] = [];
    const productPriceDrafts: ProductPriceDraft[] = [];
    const interruptedProductDrafts = new Map<string, ProductPriceDraft | null>();
    if (!directory.exists) return { entries, recovery, productPriceDrafts, interruptedProductDrafts };
    for (const file of directory.list()) {
      const price = /^([A-Za-z0-9_-]{1,128})\.price\.json$/.exec(file.name);
      const receipt = /^([A-Za-z0-9_-]{1,128})\.receipt\.json$/.exec(file.name);
      const needsShop = /^([A-Za-z0-9_-]{1,128})\.needs-shop\.json$/.exec(file.name);
      const productDraft = productPriceDraftName.exec(file.name);
      const productChoice = productPriceChoiceName.exec(file.name);
      const staged = /^(([A-Za-z0-9_-]{1,128})\.(?:price|receipt|needs-shop|product-price-draft|product-price-choice)\.json)\.[\w-]+\.pending$/.exec(file.name);
      if (staged) {
        try {
          const committed = new File(directory, staged[1]);
          if (file instanceof File && committed.exists && await file.text() === await committed.text()) continue;
          if (!committed.exists && productPriceDraftName.test(staged[1])) {
            const sourceId = staged[2];
            try {
              if (!(file instanceof File)) throw Error('The staged product draft is not a file.');
              const draft = await readProductPriceDraft(file, sourceId);
              const previous = interruptedProductDrafts.get(sourceId);
              interruptedProductDrafts.set(sourceId,
                previous !== undefined && JSON.stringify(previous) !== JSON.stringify(draft) ? null : draft);
            } catch {
              interruptedProductDrafts.set(sourceId, null);
            }
            continue;
          }
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
      } else if (productDraft) {
        const sourceId = productDraft[1];
        try {
          if (!(file instanceof File)) throw Error('The product draft is not a file.');
          const draft = await readProductPriceDraft(file, sourceId);
          productPriceDrafts.push(draft);
          if (!priceFile(sourceId).exists && await restoreProductPriceChoice(sourceId, false)) {
            recovery.push({ sourceId, reason: 'unfinished', confirmedProductTitle: draft.record.review?.productName ?? 'Saved product' });
          }
        } catch {
          recovery.push({ sourceId, reason: 'unreadable' });
        }
      } else if (productChoice) {
        const sourceId = productChoice[1];
        try {
          if (!(file instanceof File) || !productPriceDraftFile(sourceId).exists) throw Error('The product choice is missing its draft.');
          await readChoiceFile(file, sourceId);
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
    for (const [sourceId, draft] of interruptedProductDrafts) {
      recovery.push({ sourceId, reason: draft ? 'unfinished' : 'unreadable' });
    }
    return { entries, recovery, productPriceDrafts, interruptedProductDrafts };
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
            if (/\.product-price-draft\.json(?:\.[\w-]+\.pending)?$/.test(file.name)) {
              await readProductPriceDraft(file, sourceId);
            }
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
        if (hasProductPriceDraft(record.id)) throw Error('Review the product draft before saving this price.');
        await publishPrice(record);
      });
    },
    saveNeedsShop(value: LocalPhotoDraft) {
      const record = requirePriceRecord(value, true);
      return serializePublication(async () => {
        if (priceFile(record.id).exists) throw Error('This price already has a confirmed shop.');
        if (hasProductPriceDraft(record.id)) throw Error('Review the product draft before saving this price.');
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
      const { entries, recovery } = await readEntries();
      return { entries, recovery };
    },
    stageProductPrice(input: ProductPriceDraft) {
      const draft = requireProductPriceDraft(input);
      return serializePublication(async () => {
        const target = productPriceDraftFile(draft.record.id);
        if (target.exists) {
          const previous = await readProductPriceDraft(target, draft.record.id);
          if (JSON.stringify(previous) !== JSON.stringify(draft)) throw Error('A different product draft already uses this price ID.');
          return previous;
        }
        const { id } = draft.record;
        if (priceFile(id).exists || receiptFile(id).exists || needsShopFile(id).exists) {
          throw Error('A price with this ID is already saved.');
        }
        const interrupted = (await readEntries()).interruptedProductDrafts.get(id);
        if (interrupted !== undefined && JSON.stringify(interrupted) !== JSON.stringify(draft)) {
          throw Error('A different product draft already uses this price ID.');
        }
        await publish(target, JSON.stringify({ format: 1, owner, draft }));
        return draft;
      });
    },
    readProductPriceDrafts() {
      return serializePublication(async () => {
        const { productPriceDrafts, interruptedProductDrafts } = await readEntries();
        for (const [id, draft] of interruptedProductDrafts) {
          if (!draft || priceFile(id).exists || receiptFile(id).exists || needsShopFile(id).exists) continue;
          await publish(productPriceDraftFile(id), JSON.stringify({ format: 1, owner, draft }));
          productPriceDrafts.push(draft);
        }
        return productPriceDrafts.filter(draft => !priceFile(draft.record.id).exists);
      });
    },
    confirmProductPriceChoice(sourceId: string, input: ProductPriceChoice) {
      const choice = requireProductChoice(input);
      return serializePublication(async () => {
        const draft = await readProductPriceDraft(productPriceDraftFile(sourceId), sourceId);
        const stored = await restoreProductPriceChoice(sourceId);
        if (stored && JSON.stringify(stored) !== JSON.stringify(choice)) throw Error('This draft already has a different confirmed product.');
        if (!stored) await writeChoice(productPriceChoiceFile(sourceId), sourceId, choice);
        return { draft, choice: stored ?? choice };
      });
    },
    readConfirmedProductPrices() {
      return serializePublication(async () => {
        const { productPriceDrafts } = await readEntries();
        const confirmed: { draft: ProductPriceDraft; choice: ProductPriceChoice }[] = [];
        for (const draft of productPriceDrafts) {
          if (priceFile(draft.record.id).exists) continue;
          const choice = await restoreProductPriceChoice(draft.record.id).catch(() => undefined);
          if (choice) confirmed.push({ draft, choice });
        }
        return confirmed;
      });
    },
    promoteProductPrice(sourceId: string) {
      return serializePublication(async () => {
        const draft = await readProductPriceDraft(productPriceDraftFile(sourceId), sourceId);
        const choice = await restoreProductPriceChoice(sourceId);
        if (!choice) throw Error('Review the product draft before saving this price.');
        const record = requirePriceRecord({ ...draft.record,
          productId: choice.kind === 'reuse' ? choice.productId : draft.record.productId });
        const file = priceFile(sourceId);
        if (file.exists) {
          const queued = await readPrice(file, sourceId);
          if (!queued.body || JSON.stringify(queued.record) !== JSON.stringify(record)) {
            throw Error('A different price is already queued with this ID.');
          }
          return queued.record;
        }
        await publishPrice(record);
        return record;
      });
    },
    backup() {
      return serializePublication(async () => {
        const { interruptedProductDrafts, ...saved } = await readEntries();
        const recovered = [...interruptedProductDrafts.values()].flatMap(draft => draft ? [draft] : []);
        return { ...saved, productPriceDrafts: [...saved.productPriceDrafts, ...recovered],
          files: await readQueueBackupFiles(directory, backupFileName) };
      });
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
