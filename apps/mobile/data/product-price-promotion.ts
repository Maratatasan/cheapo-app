import type { Product } from '@cheapo/domain';

import { isSavedPriceRecord, saveLocalPhoto } from './local-photo';
import { reviewComplete, savedProductDetails } from './photo-review';
import type { PriceAppendQueue, ProductPriceChoice, ProductPriceDraft, ProductPriceDraftUpdate } from './price-append-queue';
import type { ShoppingMutationQueue } from './shopping-mutation-queue';

export function createProductPricePromotion(
  priceQueue: PriceAppendQueue,
  mutationQueue: ShoppingMutationQueue,
  assertOwner: () => Promise<void>,
) {
  async function stage(input: ProductPriceDraft) {
    // Copy the reviewed values before awaiting enrollment or file I/O.
    const source = input.record;
    const { shop, review, productId } = source;
    if (!isSavedPriceRecord(source) || !shop || !productId || !review || !reviewComplete(review, shop.displayName)) {
      throw Error('A reviewed price and saved shop are required.');
    }
    const fields = { ...source, productId, review: { ...review }, shop: { ...shop } };
    const proposed: ProductPriceDraft = { ...input, record: source.original ? {
      ...fields, original: { ...source.original }, selected: { ...source.selected },
      cropBox: source.cropBox && { ...source.cropBox },
    } : { ...fields, original: undefined, selected: undefined, cropBox: undefined } };
    await assertOwner();
    if (proposed.record.original) {
      await saveLocalPhoto(proposed.record, async record => {
        await assertOwner();
        await priceQueue.stageProductPrice({ ...proposed, record });
      });
    } else await priceQueue.stageProductPrice(proposed);
    await assertOwner();
  }

  async function pendingDrafts() {
    await assertOwner();
    const drafts = await priceQueue.readProductPriceDrafts();
    const confirmed = new Set((await priceQueue.readConfirmedProductPrices()).map(({ draft }) => draft.record.id));
    await assertOwner();
    return drafts.filter(draft => !confirmed.has(draft.record.id));
  }

  async function update(sourceId: string, input: ProductPriceDraftUpdate) {
    const edited = { ...input, review: { ...input.review } };
    await assertOwner();
    const draft = await priceQueue.updateProductPriceDraft(sourceId, edited);
    await assertOwner();
    return draft;
  }

  async function promote(draft: ProductPriceDraft, choice: ProductPriceChoice) {
    await assertOwner();
    // The checked price and explicit choice are already durable. A process
    // interruption after catalog enqueue can safely repeat the same operation.
    if (choice.kind === 'add') {
      const { record, barcode, catalogOperationId, createdAt } = draft;
      if (!record.productId || !record.review) throw Error('Reopen the saved product draft.');
      const product: Product = { id: record.productId, ...savedProductDetails(record.review), ...(barcode ? { barcode } : {}) };
      await mutationQueue.enqueue({ operationId: catalogOperationId, createdAt,
        title: `Save ${product.name}`.slice(0, 128), action: { kind: 'create-product', product } });
    }
    await assertOwner();
    const record = await priceQueue.promoteProductPrice(draft.record.id);
    await assertOwner();
    return record;
  }

  async function confirm(sourceId: string, input: ProductPriceChoice, expectedRevision?: number) {
    const choiceAtTap = { ...input };
    await assertOwner();
    const { draft, choice } = await priceQueue.confirmProductPriceChoice(sourceId, choiceAtTap, expectedRevision);
    return promote(draft, choice);
  }

  async function recover() {
    await assertOwner();
    const pending = await priceQueue.readConfirmedProductPrices();
    for (const { draft, choice } of pending) {
      try {
        await promote(draft, choice);
      } catch {
        // This draft remains available for recovery. Keep unrelated work moving.
        await assertOwner();
      }
    }
  }

  return { stage, pendingDrafts, update, confirm, recover };
}
