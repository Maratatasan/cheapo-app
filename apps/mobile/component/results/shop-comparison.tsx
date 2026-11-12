import { Fragment, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { comparePrices, normalizedUnitPrice, type ComparisonPrice } from "@/data/comparison-prices";
import { dateLabel, observationShopLabel } from "@/data/observation";
import { DisplayState } from "./display-state";
import { PriceDisplay } from "./price-display";
import { SampleNotice } from "./sample-notice";
import { ShopCard, type ShopCardProps } from "./shop-card";
import { color, radius, spacing, typography, ui } from "./theme";

export type ComparisonRow = ComparisonPrice & Pick<ShopCardProps, "shop" | "product" | "area" | "capturedOn">;

export type ShopComparisonProps = {
  product: { name: string; pack?: string; photo?: ImageSourcePropType };
  comparisons: readonly ComparisonRow[];
  reference?: ComparisonRow;
  state?: "ready" | "loading" | "error";
  onRetry?: () => void;
  sample?: boolean;
};

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
  sample = false,
}: ShopComparisonProps) {
  const [failedPhoto, setFailedPhoto] = useState<ImageSourcePropType>();
  const photo = product.photo;
  const [sameVariety, setSameVariety] = useState(false);
  const [sameBrand, setSameBrand] = useState(false);
  const ranked = comparePrices(comparisons, reference, { sameVariety, sameBrand });
  const referenceUnitPrice = normalizedUnitPrice(reference?.unit_price);

  return (
    <View style={styles.content}>
      <View style={ui.card}>
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
            <Text style={ui.body}>Photo unavailable</Text>
          </View>
        )}
        <Text accessibilityRole="header" style={styles.product}>{product.name}</Text>
        {product.pack ? <Text style={ui.body}>{product.pack}</Text> : null}
        {reference ? (
          <>
            <Text style={ui.body}>{observationShopLabel(reference.shop)}</Text>
            {reference.capturedOn ? <Text style={ui.small}>Recorded {dateLabel(reference.capturedOn)}</Text> : null}
            <Text style={ui.small}>{[reference.productType, reference.variety, reference.brand].filter(Boolean).join(" · ")}</Text>
            <PriceDisplay price={reference.price} currency={reference.currency} unit_price={referenceUnitPrice ?? reference.unit_price ?? null} showPackLabel />
          </>
        ) : null}
      </View>

      {sample ? <SampleNotice /> : null}

      <Text accessibilityRole="header" style={styles.heading}>Compare shop prices</Text>
      {reference && state === "ready" ? (
        <>
          {!sample ? <Text style={ui.small}>Saved prices · Check when each price was recorded.</Text> : null}
          <View style={styles.filters}>
            <FilterPill label="Same variety" checked={sameVariety} onPress={() => setSameVariety(!sameVariety)} />
            <FilterPill label="Same brand" checked={sameBrand} onPress={() => setSameBrand(!sameBrand)} />
          </View>
          {!sameVariety && !sameBrand ? <Text style={ui.small}>Price first · Any variety or brand within the same product type</Text> : null}
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
            <Text style={ui.body}>
              {ranked.groups.length > 1 ? "Lowest unit price first within each unit" : "Lowest unit price first"}
            </Text>
          ) : null}
          {ranked.groups.map(({ unit, currency, entries }) => (
            <Fragment key={`${unit}-${currency}`}>
              {ranked.groups.length > 1 ? (
                <Text accessibilityRole="header" style={styles.group}>Per {unit}{ranked.groups.some(group => group.currency !== currency) ? ` (${currency})` : ""}</Text>
              ) : null}
              {entries.map(({ row, unitPrice }) => (
                <ShopCard key={row.id} shop={row.shop} product={row.product} area={row.area} capturedOn={row.capturedOn} price={row.price} currency={row.currency} unit_price={unitPrice} />
              ))}
            </Fragment>
          ))}
          {ranked.unranked.length > 0 ? (
            <>
              <Text accessibilityRole="header" style={styles.group}>Unranked prices</Text>
              <Text style={ui.small}>{reference && !referenceUnitPrice
                ? "The selected product has no comparable unit price."
                : "These prices have no comparable unit price."}</Text>
              {ranked.unranked.map(({ id, shop, product, area, capturedOn, price, currency, unit_price }) => (
                <ShopCard key={id} shop={shop} product={product} area={area} capturedOn={capturedOn} price={price} currency={currency} unit_price={unit_price} />
              ))}
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: "100%", maxWidth: 620, alignSelf: "center", gap: spacing.md },
  photo: {
    width: "100%",
    height: 180,
    borderRadius: radius.control,
    backgroundColor: color.cream,
  },
  placeholder: { height: 104, alignItems: "center", justifyContent: "center" },
  product: { color: color.ink, fontSize: typography.price, fontWeight: "800" },
  heading: { color: color.ink, fontSize: typography.section, fontWeight: "700" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  filter: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48,
    paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1,
    borderColor: color.line, backgroundColor: color.white,
  },
  checkedFilter: { borderColor: color.green, backgroundColor: color.mint },
  checkbox: {
    width: 20, height: 20, borderWidth: 1, borderColor: color.green,
    borderRadius: 4, alignItems: "center", justifyContent: "center",
  },
  checkedBox: { backgroundColor: color.green },
  checkmark: { color: color.white, fontWeight: "800" },
  filterLabel: { color: color.ink, fontWeight: "700" },
  group: { color: color.ink, fontSize: typography.label, fontWeight: "700" },
});
