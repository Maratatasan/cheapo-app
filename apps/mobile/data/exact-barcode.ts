import type { createEnrolledCatalog } from './enrolled-catalog';
import { findLocalProductByBarcode } from './local-products';

export function findCatalogProductByBarcode(
  catalog: Pick<ReturnType<typeof createEnrolledCatalog>, 'findByBarcode'> | null,
  barcode: string,
  signal?: AbortSignal,
) {
  return catalog ? catalog.findByBarcode(barcode, signal) : findLocalProductByBarcode(barcode);
}
