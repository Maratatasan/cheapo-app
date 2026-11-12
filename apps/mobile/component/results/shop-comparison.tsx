import { Fragment, useState } from "react";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { knownUnitPrice } from "@/data/observation";
import { DisplayState } from "./display-state";
import { SampleNotice } from "./sample-notice";
import { ShopCard, type ShopCardProps } from "./shop-card";
import { color, radius, spacing, typography, ui } from "./theme";

type Comparison = Pick<ShopCardProps, "shop" | "price" | "currency" | "unit_price"> & { id: string };

export type ShopComparisonProps = {
  product: { name: string; pack: string; photo?: ImageSourcePropType };
  comparisons: readonly Comparison[];
  state?: "ready" | "loading" | "error";
  onRetry?: () => void;
  sample?: boolean;
};

function rankByUnit(comparisons: readonly Comparison[]) {
  const groups = new Map<string, { comparison: Comparison; amount: number }[]>();
  const unknown: Comparison[] = [];

  for (const comparison of comparisons) {
    const unitPrice = knownUnitPrice(comparison.unit_price);
    if (!unitPrice) {
      unknown.push(comparison);
      continue;
    }

    const unit = unitPrice.unit.trim().toLowerCase();
    const entries = groups.get(unit) ?? [];
    entries.push({ comparison, amount: unitPrice.amount });
    groups.set(unit, entries);
  }

  return {
    groups: Array.from(groups, ([unit, entries]) => ({
      unit,
      comparisons: entries.sort((first, second) => first.amount - second.amount)
        .map(({ comparison }) => comparison),
    })),
    unknown,
  };
}

export function ShopComparison({
  product,
  comparisons,
  state = "ready",
  onRetry,
  sample = false,
}: ShopComparisonProps) {
  const [failedPhoto, setFailedPhoto] = useState<ImageSourcePropType>();
  const photo = product.photo;
  const ranked = rankByUnit(comparisons);

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
        <Text style={ui.body}>{product.pack}</Text>
      </View>

      {sample ? <SampleNotice /> : null}

      <Text accessibilityRole="header" style={styles.heading}>Compare shop prices</Text>
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
      ) : comparisons.length === 0 ? (
        <DisplayState
          kind="empty"
          title="No saved prices yet"
          description="Saved prices for this item will appear here."
        />
      ) : (
        <>
          {ranked.groups.length > 0 ? (
            <Text style={ui.body}>
              {ranked.groups.length > 1 ? "Lowest unit price first within each unit" : "Lowest unit price first"}
            </Text>
          ) : null}
          {ranked.groups.map(({ unit, comparisons: shops }) => (
            <Fragment key={unit}>
              {ranked.groups.length > 1 ? (
                <Text accessibilityRole="header" style={styles.group}>Per {unit}</Text>
              ) : null}
              {shops.map(({ id, ...shop }) => <ShopCard key={id} {...shop} />)}
            </Fragment>
          ))}
          {ranked.unknown.map(({ id, ...shop }) => <ShopCard key={id} {...shop} />)}
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
  group: { color: color.ink, fontSize: typography.label, fontWeight: "700" },
});
