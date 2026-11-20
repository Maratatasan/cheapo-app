import { derivePackageUnitPrices, type PackageMeasures, type PackagePriceBasis } from '@cheapo/domain';
import { comparisonProductTypeKey } from '@cheapo/domain/comparison-product-types';
import { normalizeName } from '@cheapo/domain/names';

import { knownUnitPrice, type PriceValues } from './observation';
import type { ProductMetadata } from './product-metadata';
import { reviewedPackParts } from './reviewed-pack';

export type ComparisonPrice = ProductMetadata & Omit<PriceValues, 'unit_price'> &
  Partial<Pick<PriceValues, 'unit_price'>> & { id: string; productId?: string | null; pack?: string };
export type ComparisonFilters = { sameVariety: boolean; sameBrand: boolean };

type Unit = 'kg' | 'litre' | 'item';
type UnitPrice = { amount: number; unit: Unit | '100 g' | '100 mL' | 'wash' };
const units: Record<string, { unit: Unit; multiplier: number }> = {
  kg: { unit: 'kg', multiplier: 1 },
  g: { unit: 'kg', multiplier: 1000 },
  litre: { unit: 'litre', multiplier: 1 },
  litres: { unit: 'litre', multiplier: 1 },
  liter: { unit: 'litre', multiplier: 1 },
  liters: { unit: 'litre', multiplier: 1 },
  l: { unit: 'litre', multiplier: 1 },
  ml: { unit: 'litre', multiplier: 1000 },
  item: { unit: 'item', multiplier: 1 },
  items: { unit: 'item', multiplier: 1 },
  each: { unit: 'item', multiplier: 1 },
  unit: { unit: 'item', multiplier: 1 },
  units: { unit: 'item', multiplier: 1 },
  egg: { unit: 'item', multiplier: 1 },
  eggs: { unit: 'item', multiplier: 1 },
};

export function normalizedUnitPrice(value: ComparisonPrice['unit_price']): UnitPrice | null {
  const price = knownUnitPrice(value);
  if (!price) return null;
  const match = /^(?:per\s+)?(?:(\d+(?:\.\d+)?)\s*)?([a-z]+)$/.exec(price.unit.trim().toLowerCase());
  if (!match || !Object.hasOwn(units, match[2])) return null;
  const quantity = Number(match[1] ?? 1);
  const { unit, multiplier } = units[match[2]];
  const amount = price.amount * multiplier / quantity;
  return Number.isFinite(quantity) && quantity > 0 && Number.isFinite(amount) ? { amount, unit } : null;
}

export function matchComparisonName(value?: string) {
  return normalizeName(value)?.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
}

const bases = {
  kg: { unit: 'kg', parent: 'kg', ratio: 1 },
  '100g': { unit: '100 g', parent: 'kg', ratio: 0.1 },
  litre: { unit: 'litre', parent: 'litre', ratio: 1 },
  '100mL': { unit: '100 mL', parent: 'litre', ratio: 0.1 },
  item: { unit: 'item', parent: 'item', ratio: 1 },
  wash: { unit: 'wash', parent: 'wash', ratio: 1 },
} as const;

function reviewedPackageMeasures(pack?: string): PackageMeasures {
  const parts = pack && reviewedPackParts(pack);
  const key = parts && parts.unit.toLowerCase();
  if (!parts || !key || !Object.hasOwn(units, key)) return {};
  const { unit, multiplier } = units[key];
  const quantity = Number(parts.quantity) * parts.count / multiplier;
  if (unit === 'kg') return { mass: { total: { quantity, unit: 'kg' } } };
  if (unit === 'litre') return { volume: { total: { quantity, unit: 'L' } } };
  return { itemCount: quantity };
}

export function comparisonUnitPrice(row?: ComparisonPrice, basis?: PackagePriceBasis): UnitPrice | null {
  const saved = knownUnitPrice(row?.unit_price);
  const normalized = normalizedUnitPrice(saved);
  if (!basis || !row) return normalized;
  if (!row.currency || !/^[A-Z]{3}$/.test(row.currency)) return null;
  const choice = bases[basis];
  if (normalized?.unit === choice.parent) return { amount: normalized.amount * choice.ratio, unit: choice.unit };
  if (basis === 'wash' && saved && /^(?:per\s+)?wash$/i.test(saved.unit.trim())) return { amount: saved.amount, unit: 'wash' };
  if (row.price === null) return null;
  const derived = derivePackageUnitPrices({ amount: row.price, currency: row.currency }, reviewedPackageMeasures(row.pack))[basis];
  return derived ? { amount: derived.amount, unit: choice.unit } : null;
}

export function comparePrices<T extends ComparisonPrice>(
  prices: readonly T[], reference?: ComparisonPrice,
  filters: ComparisonFilters = { sameVariety: false, sameBrand: false },
  catalogProduct?: ProductMetadata,
  exactProductId?: string,
  basis?: PackagePriceBasis,
) {
  const selection = catalogProduct ?? reference;
  const type = comparisonProductTypeKey(selection?.productType);
  const variety = matchComparisonName(selection?.variety);
  const brand = matchComparisonName(selection?.brand);
  const missing: string[] = [];
  if (selection) {
    if (!type && !exactProductId) missing.push('product type');
    else {
      if (filters.sameVariety && !variety) missing.push('variety');
      if (filters.sameBrand && !brand) missing.push('brand');
    }
  }
  const referenceUnit = comparisonUnitPrice(reference, basis)?.unit;
  const groups = new Map<string, { unit: UnitPrice['unit']; currency: string; entries: { row: T; unitPrice: UnitPrice }[] }>();
  const unranked: T[] = [];
  const differentBasis: T[] = [];
  if (missing.length) return { groups: [], unranked, differentBasis, missing };

  for (const row of prices) {
    if (reference && (row.id === reference.id || row.currency !== reference.currency)) continue;
    if (exactProductId && row.productId !== exactProductId) continue;
    if (selection && ((!exactProductId && comparisonProductTypeKey(row.productType) !== type) ||
      (filters.sameVariety && matchComparisonName(row.variety) !== variety) || (filters.sameBrand && matchComparisonName(row.brand) !== brand))) continue;
    const unitPrice = comparisonUnitPrice(row, basis);
    if (!unitPrice || !row.currency || !/^[A-Z]{3}$/.test(row.currency) || (reference && !referenceUnit && !catalogProduct && !basis)) {
      unranked.push(row);
      continue;
    }
    if (referenceUnit && referenceUnit !== unitPrice.unit) {
      differentBasis.push(row);
      continue;
    }
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
    differentBasis,
    missing,
  };
}
