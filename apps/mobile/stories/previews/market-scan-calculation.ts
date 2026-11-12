import { normalizedUnitPrice } from '../../data/comparison-prices';

export function scanUnitPrice(total: string, pack: string) {
  const amount = Number(total);
  if (!/^\d+(?:\.\d{1,2})?$/.test(total.trim()) || amount <= 0 || amount > 9999999.99) return null;
  if (!/^\d+(?:\.\d+)?\s*[a-z]+$/i.test(pack.trim())) return null;
  return normalizedUnitPrice({ amount, unit: pack.trim().replace(/(items|litres|liters)$/i, unit => unit.slice(0, -1)) });
}
