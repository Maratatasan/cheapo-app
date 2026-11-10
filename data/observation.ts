export type Observation = {
  id: string;
  shop: string;
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

export type PriceValues = Pick<
  Observation,
  "price" | "currency" | "unit_price"
>;

export function priceLabel(item: Pick<PriceValues, "price" | "currency">) {
  return item.price !== null && Number.isFinite(item.price) && item.price >= 0
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: item.currency,
      }).format(item.price)
    : "Price to review";
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
  return `${new Intl.NumberFormat("en-GB", { style: "currency", currency: item.currency }).format(value.amount)} / ${value.unit}`;
}
export function dateLabel(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
