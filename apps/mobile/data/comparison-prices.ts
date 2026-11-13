import { normalizeName } from '@cheapo/domain/names';

import { knownUnitPrice, type PriceValues } from './observation';
import type { ProductMetadata } from './product-metadata';

export type ComparisonPrice = ProductMetadata & Omit<PriceValues, 'unit_price'> &
  Partial<Pick<PriceValues, 'unit_price'>> & { id: string };
export type ComparisonFilters = { sameVariety: boolean; sameBrand: boolean };

type Unit = 'kg' | 'litre' | 'item';
type UnitPrice = { amount: number; unit: Unit };
const units: Record<string, { unit: Unit; multiplier: number }> = {
  kg: { unit: 'kg', multiplier: 1 },
  g: { unit: 'kg', multiplier: 1000 },
  litre: { unit: 'litre', multiplier: 1 },
  liter: { unit: 'litre', multiplier: 1 },
  l: { unit: 'litre', multiplier: 1 },
  ml: { unit: 'litre', multiplier: 1000 },
  item: { unit: 'item', multiplier: 1 },
  each: { unit: 'item', multiplier: 1 },
};

export function normalizedUnitPrice(value: ComparisonPrice['unit_price']): UnitPrice | null {
  const price = knownUnitPrice(value);
  if (!price) return null;
  const match = /^(?:(\d+(?:\.\d+)?)\s*)?(kg|g|litre|liter|l|ml|item|each)$/.exec(price.unit.trim().toLowerCase());
  if (!match) return null;
  const quantity = Number(match[1] ?? 1);
  const { unit, multiplier } = units[match[2]];
  const amount = price.amount * multiplier / quantity;
  return Number.isFinite(quantity) && quantity > 0 && Number.isFinite(amount) ? { amount, unit } : null;
}

function matchName(value?: string) {
  return normalizeName(value)?.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

export function comparePrices<T extends ComparisonPrice>(
  prices: readonly T[], reference?: ComparisonPrice,
  filters: ComparisonFilters = { sameVariety: false, sameBrand: false },
  catalogProduct?: ProductMetadata,
) {
  const selection = catalogProduct ?? reference;
  const type = matchName(selection?.productType);
  const variety = matchName(selection?.variety);
  const brand = matchName(selection?.brand);
  const missing: string[] = [];
  if (selection) {
    if (!type) missing.push('product type');
    else {
      if (filters.sameVariety && !variety) missing.push('variety');
      if (filters.sameBrand && !brand) missing.push('brand');
    }
  }
  const referenceUnit = normalizedUnitPrice(reference?.unit_price)?.unit;
  const groups = new Map<string, { unit: Unit; currency: string; entries: { row: T; unitPrice: UnitPrice }[] }>();
  const unranked: T[] = [];
  if (missing.length) return { groups: [], unranked, missing };

  for (const row of prices) {
    if (reference && (row.id === reference.id || row.currency !== reference.currency)) continue;
    if (selection && (matchName(row.productType) !== type ||
      (filters.sameVariety && matchName(row.variety) !== variety) || (filters.sameBrand && matchName(row.brand) !== brand))) continue;
    const unitPrice = normalizedUnitPrice(row.unit_price);
    if (!unitPrice || !row.currency || !/^[A-Z]{3}$/.test(row.currency) || (reference && !referenceUnit && !catalogProduct)) {
      unranked.push(row);
      continue;
    }
    if (referenceUnit && referenceUnit !== unitPrice.unit) continue;
    const key = `${unitPrice.unit}-${row.currency}`;
    const group = groups.get(key) ?? { unit: unitPrice.unit, currency: row.currency, entries: [] };
    group.entries.push({ row, unitPrice });
    groups.set(key, group);
  }
  return {
    groups: [...groups.values()].map(group => ({
      ...group, entries: group.entries.sort((a, b) => a.unitPrice.amount - b.unitPrice.amount),
    })),
    unranked,
    missing,
  };
}
