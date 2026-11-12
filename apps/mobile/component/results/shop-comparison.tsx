import { useState } from "react";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { DisplayState } from "./display-state";
import { SampleNotice } from "./sample-notice";
import { ShopCard, type ShopCardProps } from "./shop-card";
import { color, radius, spacing, typography, ui } from "./theme";

export type ShopComparisonProps = {
  product: { name: string; pack: string; photo?: ImageSourcePropType };
  comparisons: readonly (Pick<ShopCardProps, "shop" | "price" | "currency" | "unit_price"> & { id: string })[];
  state?: "ready" | "loading" | "error";
  onRetry?: () => void;
  sample?: boolean;
};

export function ShopComparison({
  product,
  comparisons,
  state = "ready",
  onRetry,
  sample = false,
}: ShopComparisonProps) {
  const [failedPhoto, setFailedPhoto] = useState<ImageSourcePropType>();
  const photo = product.photo;

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
        comparisons.map(({ id, ...shop }) => <ShopCard key={id} {...shop} />)
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
});
