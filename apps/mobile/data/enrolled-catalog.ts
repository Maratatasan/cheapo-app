import { productSchema, type Product } from '@cheapo/domain';
import { canonicalProductBarcode } from '@cheapo/domain/product-barcode';
import { randomUUID } from 'expo-crypto';

import type { EditableProductRead, ShoppingRead } from './cheapo-shopping-reads';
import type { QueuedShoppingMutation, ShoppingMutationQueue } from './shopping-mutation-queue';
import { shoppingMutation, type ShoppingMutation } from './shopping-mutations';

type CatalogAction = Extract<ShoppingMutation['action'], { kind: 'create-product' | 'edit-product' }>;
type ProductBase = Extract<CatalogAction, { kind: 'edit-product' }>['base'];
export type EditableCatalogProduct = Product & { catalogBase?: ProductBase };
type CatalogEntry = { product: Product; operationId: string; version?: number };

type Dependencies = {
  queue: Pick<ShoppingMutationQueue, 'read' | 'enqueue'>;
  readByBarcode: (barcode: string, signal?: AbortSignal) => Promise<ShoppingRead<EditableProductRead>>;
  readById: (id: string, signal?: AbortSignal) => Promise<ShoppingRead<EditableProductRead>>;
  assertCurrent: () => Promise<void>;
  sync: () => Promise<unknown>;
};

function catalogEntries(entries: QueuedShoppingMutation[]) {
  const latest = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    const { action, operationId } = entry.intent;
    if (entry.superseded || (action.kind !== 'create-product' && action.kind !== 'edit-product')) continue;
    const { outcome, resolution } = entry;
    if (resolution) {
      if (resolution.kind === 'keep-cloud' && outcome?.kind === 'conflict' && typeof outcome.currentVersion === 'number') {
        const checked = productSchema.safeParse(outcome.current);
        if (checked.success && checked.data.id === action.product.id) {
          latest.set(checked.data.id, { product: checked.data, operationId, version: outcome.currentVersion });
        }
      }
      continue;
    }
    const receiptVersion = outcome?.kind === 'applied' ? outcome.receipt.version : undefined;
    latest.set(action.product.id, { product: action.product, operationId,
      version: typeof receiptVersion === 'number' ? receiptVersion : undefined });
  }
  return latest;
}

function queuedProduct(entry: CatalogEntry): EditableCatalogProduct {
  const { product, version, operationId } = entry;
  return { ...product, catalogBase: version === undefined ? { kind: 'operation', operationId } : { kind: 'version', version } };
}

export function createEnrolledCatalog(dependencies: Dependencies) {
  let pending: Promise<unknown> = Promise.resolve();

  async function lookup(
    matches: (product: Product) => boolean,
    read: () => Promise<ShoppingRead<EditableProductRead>>,
  ): Promise<EditableCatalogProduct | undefined> {
    await dependencies.assertCurrent();
    const before = catalogEntries((await dependencies.queue.read()).entries);
    const pendingMatch = [...before.values()].findLast(entry => entry.version === undefined && matches(entry.product));
    if (pendingMatch) {
      await dependencies.assertCurrent();
      return queuedProduct(pendingMatch);
    }

    const response = await read();
    const current = catalogEntries((await dependencies.queue.read()).entries);
    await dependencies.assertCurrent();
    const remote = response.status === 'unavailable' ? undefined : response.value;
    if (remote?.product) {
      const observed = remote.product;
      if (!matches(observed)) throw Error('Cheapo returned a different product.');
      const local = current.get(observed.id);
      if (local && (local.version === undefined || local.version > remote.version)) {
        if (!matches(local.product)) throw Error('This barcode has a saved correction. Scan the updated barcode.');
        return queuedProduct(local);
      }
      return { ...observed, catalogBase: { kind: 'version', version: remote.version } };
    }

    const local = [...current.values()].findLast(entry => {
      if (!matches(entry.product)) return false;
      const beforeRead = before.get(entry.product.id);
      const settledBeforeRead = beforeRead?.operationId === entry.operationId && beforeRead.version !== undefined;
      return response.status !== 'fresh' || !settledBeforeRead;
    });
    if (local) return queuedProduct(local);
    if (response.status === 'unavailable') throw Error('Could not check this product offline. Try again when you’re connected.');
    return undefined;
  }

  function saveAction(action: CatalogAction): Promise<EditableCatalogProduct> {
    const next = pending.then(async () => {
      await dependencies.assertCurrent();
      const { entries } = await dependencies.queue.read();
      const latest = catalogEntries(entries);
      const sameProduct = latest.get(action.product.id);
      if (action.kind === 'create-product' && sameProduct) {
        if (JSON.stringify(sameProduct.product) !== JSON.stringify(action.product)) throw Error('This product is already saved on this phone.');
        await dependencies.assertCurrent();
        return queuedProduct(sameProduct);
      }
      const operationId = randomUUID();
      const previous = entries.at(-1)?.intent.createdAt;
      const createdAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
      const intent = shoppingMutation.parse({
        operationId, createdAt, action,
        title: `${action.kind === 'create-product' ? 'Save' : 'Correct'} ${action.product.name}`.slice(0, 128),
        waitFor: sameProduct && sameProduct.version === undefined ? [sameProduct.operationId] : [],
      });
      const { product } = intent.action as CatalogAction;
      if (product.barcode && [...latest.values()].some(entry => entry.version === undefined
        && entry.product.id !== product.id && entry.product.barcode === product.barcode)) {
        throw Error('Another queued product uses this barcode.');
      }
      await dependencies.assertCurrent();
      await dependencies.queue.enqueue(intent);
      await dependencies.assertCurrent();
      void dependencies.sync().catch(() => {});
      return { ...product, catalogBase: { kind: 'operation' as const, operationId } };
    });
    pending = next.catch(() => {});
    return next;
  }

  return {
    findByBarcode(barcode: string, signal?: AbortSignal) {
      const canonical = canonicalProductBarcode(barcode);
      if (!canonical) throw Error('Enter a valid product barcode.');
      return lookup(product => product.barcode === canonical, () => dependencies.readByBarcode(canonical, signal));
    },
    findById(id: string, signal?: AbortSignal) {
      return lookup(product => product.id === id, () => dependencies.readById(id, signal));
    },
    save(input: Product) {
      return saveAction({ kind: 'create-product', product: productSchema.omit({ photoIds: true }).parse(input) });
    },
    replaceBarcode(displayed: EditableCatalogProduct, barcode: string) {
      const base = displayed.catalogBase;
      const checked = canonicalProductBarcode(barcode);
      if (!base) throw Error('Check the product version before correcting its barcode.');
      if (!checked) throw Error('Enter a valid product barcode.');
      const product = productSchema.omit({ photoIds: true }).parse({ ...displayed, barcode: checked });
      return saveAction({ kind: 'edit-product', product, base });
    },
  };
}
