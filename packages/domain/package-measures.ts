export const packagePriceBases = ['kg', '100g', 'litre', '100mL', 'item', 'wash'] as const;
export type PackagePriceBasis = (typeof packagePriceBases)[number];

type Quantity<Unit extends string> = Readonly<{ quantity: number; unit: Unit }>;

type PackageQuantities<Unit extends string> = Readonly<{
  perPack?: Quantity<Unit>;
  total?: Quantity<Unit>;
}>;

export type PackageMeasures = Readonly<{
  /** Number of identical inner packs, when confirmed. */
  packCount?: number;
  mass?: PackageQuantities<'g' | 'kg'>;
  volume?: PackageQuantities<'mL' | 'L'>;
  /** Total number of items in the package. */
  itemCount?: number;
  statedWashCount?: Readonly<{ quantity: number; source: 'manufacturer' }>;
}>;

type Price = Readonly<{ amount: number; currency: string }>;

const gramsPerUnit = { g: 1, kg: 1000 } as const;
const millilitresPerUnit = { mL: 1, L: 1000 } as const;

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function confirmedCount(value?: number): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function normalizedQuantity<Unit extends string>(
  measure: Quantity<Unit> | undefined,
  factors: Record<Unit, number>,
): number | undefined {
  if (!measure || !positive(measure.quantity) || !Object.hasOwn(factors, measure.unit)) {
    return undefined;
  }
  const quantity = measure.quantity * factors[measure.unit];
  return positive(quantity) ? quantity : undefined;
}

function totalQuantity<Unit extends string>(
  quantities: PackageQuantities<Unit> | undefined,
  factors: Record<Unit, number>,
  packCount: number | undefined,
): number | undefined {
  const total = normalizedQuantity(quantities?.total, factors);
  const perPack = normalizedQuantity(quantities?.perPack, factors);
  if (perPack === undefined || packCount === undefined) return total;

  const calculated = perPack * packCount;
  if (!positive(calculated)) return total;

  if (total === undefined) return calculated;

  // Allow rounding error from unit conversion and multiplication.
  const tolerance = Number.EPSILON * 4 * Math.max(total, calculated);
  return Math.abs(total - calculated) <= tolerance ? total : undefined;
}

/** Derive rates from the reviewed pack price. Shelf-label rates are separate observations. */
export function derivePackageUnitPrices(
  price: Price,
  measures: PackageMeasures,
): Partial<Record<PackagePriceBasis, Price>> {
  if (!positive(price.amount) || !/^[A-Z]{3}$/.test(price.currency)) return {};

  const packCount = confirmedCount(measures.packCount);
  const grams = totalQuantity(measures.mass, gramsPerUnit, packCount);
  const millilitres = totalQuantity(measures.volume, millilitresPerUnit, packCount);
  const denominators: Partial<Record<PackagePriceBasis, number>> = {
    kg: grams === undefined ? undefined : grams / 1000,
    '100g': grams === undefined ? undefined : grams / 100,
    litre: millilitres === undefined ? undefined : millilitres / 1000,
    '100mL': millilitres === undefined ? undefined : millilitres / 100,
    item: confirmedCount(measures.itemCount),
    wash: measures.statedWashCount?.source === 'manufacturer'
      ? confirmedCount(measures.statedWashCount.quantity) : undefined,
  };

  const rates: Partial<Record<PackagePriceBasis, Price>> = {};
  for (const basis of packagePriceBases) {
    const denominator = denominators[basis];
    if (denominator === undefined) continue;
    const amount = price.amount / denominator;
    if (positive(amount)) rates[basis] = { amount, currency: price.currency };
  }
  return rates;
}
