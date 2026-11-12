import { Fragment, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { comparePrices, normalizedUnitPrice, type ComparisonPrice } from "@/data/comparison-prices";
import { dateLabel, knownUnitPrice, observationShopLabel, priceLabel, unitPriceLabel, type PriceValues } from "@/data/observation";
import { DisplayState } from "./display-state";
import { SampleNotice } from "./sample-notice";
import type { ShopCardProps } from "./shop-card";
import { marketColor as color, spacing, typography } from "./theme";

export type ComparisonRow = ComparisonPrice & Pick<ShopCardProps, "shop" | "product" | "area" | "capturedOn">;

export type ShopComparisonProps = {
  product: { name: string; pack?: string; photo?: ImageSourcePropType };
  comparisons: readonly ComparisonRow[];
  reference?: ComparisonRow;
  state?: "ready" | "loading" | "error";
  onRetry?: () => void;
  onEdit?: (id: string) => void;
  sample?: boolean;
};

function ComparisonPrices({ prices, cheapest = false }: { prices: PriceValues; cheapest?: boolean }) {
  const unit = knownUnitPrice(prices.unit_price);
  return (
    <View style={styles.prices}>
      {unit ? <Text style={styles.unitPrice} accessibilityLabel={unitPriceLabel(prices)}>{priceLabel({ price: unit.amount, currency: prices.currency })} <Text style={styles.small}>/ {unit.unit.trim()}</Text></Text>
        : <Text style={styles.small}>Unit price unavailable</Text>}
      <View style={styles.packPrice}><Text style={styles.small}>{priceLabel(prices)}</Text><Text style={styles.small}>pack</Text></View>
      {cheapest ? <Text style={styles.cheapest}>Lowest unit price</Text> : null}
    </View>
  );
}

function ComparisonEdit({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.edit}>
      <Text style={styles.editText}>Edit</Text>
    </Pressable>
  );
}

function OfferRow({ row, unitPrice, cheapest, onEdit }: {
  row: ComparisonRow; unitPrice?: PriceValues['unit_price']; cheapest?: boolean; onEdit?: (id: string) => void;
}) {
  const shop = observationShopLabel(row.shop);
  const date = row.capturedOn ? dateLabel(row.capturedOn) : undefined;
  const label = `Edit ${row.product ? `${row.product} at ` : 'price at '}${shop}${date ? `, recorded ${date}` : ''}`;
  return (
    <View style={[styles.offer, cheapest && styles.lowest]}>
      <ComparisonPrices prices={{ price: row.price, currency: row.currency, unit_price: unitPrice ?? null }} cheapest={cheapest} />
      <View style={styles.details}>
        <Text style={styles.shop}>{shop}</Text>
        {date ? <Text style={styles.small}>Recorded {date}</Text> : null}
        {row.product ? <Text style={styles.small}>{row.product}</Text> : null}
        {row.area ? <Text style={styles.small}>{row.area}</Text> : null}
      </View>
      {onEdit ? <ComparisonEdit label={label} onPress={() => onEdit(row.id)} /> : null}
    </View>
  );
}

function FilterPill({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} aria-checked={checked}
      onPress={onPress} style={[styles.filter, checked && styles.checkedFilter]}>
      <View style={[styles.checkbox, checked && styles.checkedBox]}>
        {checked ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
      <Text style={styles.filterLabel}>{label}</Text>
    </Pressable>
  );
}

export function ShopComparison({
  product,
  comparisons,
  reference,
  state = "ready",
  onRetry,
  onEdit,
  sample = false,
}: ShopComparisonProps) {
  const [failedPhoto, setFailedPhoto] = useState<ImageSourcePropType>();
  const photo = product.photo;
  const [sameVariety, setSameVariety] = useState(false);
  const [sameBrand, setSameBrand] = useState(false);
  const ranked = comparePrices(comparisons, reference, { sameVariety, sameBrand });
  const referenceUnitPrice = normalizedUnitPrice(reference?.unit_price);
  const lowestAlternative = ranked.groups.length === 1 ? ranked.groups[0].entries[0]?.unitPrice.amount : undefined;
  const lowest = referenceUnitPrice && lowestAlternative !== undefined ? Math.min(referenceUnitPrice.amount, lowestAlternative) : undefined;
  const referenceLowest = lowest !== undefined && referenceUnitPrice?.amount === lowest;
  const referenceShop = reference && observationShopLabel(reference.shop);

  return (
    <View style={styles.content}>
      <View style={[styles.reference, referenceLowest && styles.lowest]}>
        {photo && photo !== failedPhoto ? (
          <Image
            accessibilityLabel={`Scan photo for ${product.name}`}
            accessibilityRole="image"
            source={photo}
            resizeMode="contain"
            onError={() => setFailedPhoto(photo)}
            style={styles.photo}
          />
        ) : (
          <View style={[styles.photo, styles.placeholder]}>
            <Text style={styles.small}>Photo unavailable</Text>
          </View>
        )}
        <View style={styles.details}>
          <Text accessibilityRole="header" style={styles.product}>{product.name}</Text>
          {product.pack ? <Text style={styles.small}>{product.pack}</Text> : null}
          {reference ? (
            <>
              <Text style={styles.small}>{referenceShop}</Text>
              {reference.capturedOn ? <Text style={styles.small}>Recorded {dateLabel(reference.capturedOn)}</Text> : null}
              <Text style={styles.small}>{[reference.productType, reference.variety, reference.brand].filter(Boolean).join(" · ")}</Text>
              <View style={styles.referenceActions}>
                <ComparisonPrices prices={{ price: reference.price, currency: reference.currency, unit_price: referenceUnitPrice ?? reference.unit_price ?? null }} cheapest={referenceLowest} />
                {onEdit ? <ComparisonEdit label={`Edit ${product.name} at ${referenceShop}`} onPress={() => onEdit(reference.id)} /> : null}
              </View>
            </>
          ) : null}
        </View>
      </View>

      {sample ? <SampleNotice /> : null}

      <Text accessibilityRole="header" style={styles.heading}>Compare shop prices</Text>
      {reference && state === "ready" ? (
        <>
          {!sample ? <Text style={styles.small}>Saved prices · Check when each price was recorded.</Text> : null}
          <View style={styles.filters}>
            <FilterPill label="Same variety" checked={sameVariety} onPress={() => setSameVariety(!sameVariety)} />
            <FilterPill label="Same brand" checked={sameBrand} onPress={() => setSameBrand(!sameBrand)} />
          </View>
          {!sameVariety && !sameBrand ? <Text style={styles.small}>Price first · Any variety or brand within the same product type</Text> : null}
        </>
      ) : null}
      {state === "loading" ? (
        <DisplayState kind="loading" title="Loading shop prices" description="Getting saved prices for this item." />
      ) : state === "error" ? (
        <DisplayState
          kind="error"
          title="Couldn’t load shop prices"
          description="Try loading the saved prices again."
          actionLabel="Retry"
          onAction={onRetry}
        />
      ) : ranked.missing.length > 0 ? (
        <DisplayState kind="empty" title="More product details needed"
          description={`Add ${ranked.missing.join(" and ")} to this saved product in Scan to use this comparison.`} />
      ) : ranked.groups.length === 0 && ranked.unranked.length === 0 ? (
        <DisplayState
          kind="empty"
          title={reference ? "No matching saved prices" : "No saved prices yet"}
          description={reference ? "Save another product of the same type with a compatible price and unit, or change the filters." : "Saved prices for this item will appear here."}
        />
      ) : (
        <>
          {ranked.groups.length > 0 ? (
            <Text style={styles.small}>
              {ranked.groups.length > 1 ? "Lowest unit price first within each unit" : "Lowest unit price first"}
            </Text>
          ) : null}
          {onEdit && ranked.groups.length > 0 ? <Text style={styles.small}>Comparison uses a common unit. Edit opens the saved amount and unit.</Text> : null}
          {ranked.groups.map(({ unit, currency, entries }) => (
            <Fragment key={`${unit}-${currency}`}>
              {ranked.groups.length > 1 ? (
                <Text accessibilityRole="header" style={styles.group}>Per {unit}{ranked.groups.some(group => group.currency !== currency) ? ` (${currency})` : ""}</Text>
              ) : null}
              <View style={styles.offers}>
                {entries.map(({ row, unitPrice }) => (
                  <OfferRow key={row.id} row={row} unitPrice={unitPrice} cheapest={unitPrice.amount === lowest} onEdit={onEdit} />
                ))}
              </View>
            </Fragment>
          ))}
          {ranked.unranked.length > 0 ? (
            <>
              <Text accessibilityRole="header" style={styles.group}>Unranked prices</Text>
              <Text style={styles.small}>{reference && !referenceUnitPrice
                ? "The selected product has no comparable unit price."
                : "These prices have no comparable unit price."}</Text>
              <View style={styles.offers}>
                {ranked.unranked.map(row => <OfferRow key={row.id} row={row} unitPrice={row.unit_price} onEdit={onEdit} />)}
              </View>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 620, alignSelf: "center", gap: spacing.md },
  reference: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: color.border, borderRadius: 12, backgroundColor: color.surface },
  photo: { width: 80, height: 104, borderRadius: 8, backgroundColor: color.mint, alignSelf: 'center' },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  details: { flex: 1, minWidth: 0, gap: 3 },
  referenceActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  product: { color: color.ink, fontSize: typography.card, fontWeight: '700' },
  prices: { width: 112, flexShrink: 1, gap: 2 },
  packPrice: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  unitPrice: { color: color.ink, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  small: { color: color.muted, fontSize: 12 },
  shop: { color: color.ink, fontSize: 15, fontWeight: '700' },
  offers: { borderColor: color.border, borderWidth: 1, borderRadius: 12, backgroundColor: color.surface, overflow: 'hidden' },
  offer: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: 10, borderBottomColor: color.border, borderBottomWidth: StyleSheet.hairlineWidth },
  lowest: { backgroundColor: color.mint },
  cheapest: { color: color.green, fontSize: 11, fontWeight: '700' },
  edit: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  editText: { color: color.green, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  heading: { color: color.ink, fontSize: typography.section, fontWeight: "700" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  filter: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48,
    paddingHorizontal: spacing.md, borderRadius: 30, borderWidth: 1,
    borderColor: color.border, backgroundColor: color.surface,
  },
  checkedFilter: { borderColor: color.green, backgroundColor: color.mint },
  checkbox: {
    width: 20, height: 20, borderWidth: 1, borderColor: color.green,
    borderRadius: 4, alignItems: "center", justifyContent: "center",
  },
  checkedBox: { backgroundColor: color.green },
  checkmark: { color: color.surface, fontWeight: "800" },
  filterLabel: { color: color.ink, fontWeight: "700" },
  group: { color: color.ink, fontSize: typography.label, fontWeight: "700" },
});
