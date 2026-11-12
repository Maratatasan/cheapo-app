import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Shop } from "@cheapo/domain";
import { normalizeName, shopDisplayName } from "@cheapo/domain/names";
import { color, radius, spacing, typography, ui } from "@/component/results/theme";
import { matchShops } from "@/data/match-shops";

export type ShopPickerProps = {
  shops: readonly Shop[];
  selectedShopId?: string;
  isLoading?: boolean;
  error?: string;
  onSelect: (shop: Shop) => void;
  onAddShop: () => void;
  onCancel: () => void;
};

export function ShopPicker({
  shops,
  selectedShopId,
  isLoading = false,
  error,
  onSelect,
  onAddShop,
  onCancel,
}: ShopPickerProps) {
  const [search, setSearch] = useState("");
  const matches = isLoading || error ? [] : matchShops(shops, search);

  return (
    <FlatList
      style={ui.page}
      contentContainerStyle={ui.content}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      data={matches}
      keyExtractor={(shop) => shop.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text accessibilityRole="header" style={ui.title}>Select current shop</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Search saved shops</Text>
            <TextInput
              accessibilityLabel="Search saved shops"
              autoCorrect={false}
              value={search}
              onChangeText={setSearch}
              placeholder="Name or nickname"
              placeholderTextColor={color.muted}
              returnKeyType="search"
              style={styles.input}
            />
          </View>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              style={ui.button}
              onPress={() => {
                Keyboard.dismiss();
                onAddShop();
              }}
            >
              <Text style={ui.buttonText}>Add a shop</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[ui.button, styles.cancel]}
              onPress={() => {
                Keyboard.dismiss();
                onCancel();
              }}
            >
              <Text style={styles.label}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      }
      ListEmptyComponent={
        isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={color.green} />
            <Text accessibilityLiveRegion="polite" style={ui.body}>Loading saved shops…</Text>
          </View>
        ) : error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {shops.length ? "No matching shops" : "No saved shops yet"}
          </Text>
        )
      }
      renderItem={({ item }) => {
        const label = shopDisplayName(item) ?? "Unnamed shop";
        const name = normalizeName(item.name);
        const details = [name !== label && name, normalizeName(item.address)].filter(Boolean).join(" · ");
        const selected = item.id === selectedShopId;

        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[ui.card, styles.shop, selected && styles.selected]}
            onPress={() => {
              Keyboard.dismiss();
              onSelect(item);
            }}
          >
            <Text style={styles.label}>{label}</Text>
            {details ? <Text style={ui.body}>{details}</Text> : null}
            {selected ? <Text style={styles.current}>Current shop</Text> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.lg },
  field: { gap: spacing.xs },
  label: { color: color.ink, fontSize: typography.label, fontWeight: "600" },
  input: {
    minHeight: 48,
    backgroundColor: color.white,
    borderColor: color.line,
    borderWidth: 1,
    borderRadius: radius.control,
    padding: spacing.md,
    color: color.ink,
    fontSize: typography.label,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  cancel: { backgroundColor: color.mint },
  loading: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  error: { color: "#A22A23", fontSize: typography.body },
  shop: { gap: spacing.xs },
  selected: { borderColor: color.green, backgroundColor: color.mint },
  current: { color: color.green, fontSize: typography.caption, fontWeight: "700" },
});
