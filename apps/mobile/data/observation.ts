import type { Shop } from "@cheapo/domain";
import { shopDisplayName } from "@cheapo/domain/names";

export type Observation = {
  id: string;
  shop: string | Shop;
  area: string;
  product: string;
  brand: string;
  pack: string;
  price: number | null;
  currency: "GBP";
  unit_price: { amount: number; unit: string } | null;
  distanceKm: number | null;
  observedOn: string;
  condition: string;
  status: "Sample observation" | "Draft · review needed";
  note?: string;
  coordinate: { latitude: number; longitude: number };
};

export function observationShopLabel(shop: Observation["shop"]) {
  return typeof shop === "string" ? shop : shopDisplayName(shop) ?? "Shop unconfirmed";
}

export type PriceValues = Pick<Observation, "price" | "unit_price"> & { currency: string | null };

export function priceLabel(item: Pick<PriceValues, "price" | "currency">) {
  if (item.price === null || !Number.isFinite(item.price) || item.price < 0) return "Price to review";
  if (!item.currency) return `${item.price} (currency unconfirmed)`;
  try { return new Intl.NumberFormat("en-GB", {style:"currency",currency:item.currency}).format(item.price); }
  catch { return `${item.price} (currency unconfirmed)`; }
}
/** Unit price may come from a visible shelf label, independently of pack price. */
export function unitPriceLabel(
  item: Pick<PriceValues, "unit_price" | "currency">,
) {
  const value = item.unit_price;
  if (
    !value ||
    !Number.isFinite(value.amount) ||
    value.amount < 0 ||
    !value.unit.trim()
  ) {
    return "Unit price unavailable";
  }
  return `${priceLabel({price:value.amount,currency:item.currency})} / ${value.unit}`;
}
export function dateLabel(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
