import { useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { shopDisplayName } from "@cheapo/domain/names";
import { color, radius, spacing, typography, ui } from "@/component/results/theme";

export type ShopFormValues = {
  nickname: string;
  name: string;
  address: string;
};

export type ShopFormProps = {
  values: ShopFormValues;
  editing?: boolean;
  onRemove?: () => void;
  error?: string;
  isSubmitting?: boolean;
  onChange: (values: ShopFormValues) => void;
  onSubmit: (values: ShopFormValues) => void;
  onCancel: () => void;
};

const fields = [
  { key: "nickname", label: "Nickname", placeholder: "Tandem Centre Lidl" },
  { key: "name", label: "Shop name", placeholder: "Lidl" },
  { key: "address", label: "Address (optional)" },
] as const;

export function ShopForm({
  values,
  editing = false,
  onRemove,
  error,
  isSubmitting = false,
  onChange,
  onSubmit,
  onCancel,
}: ShopFormProps) {
  const [submitted, setSubmitted] = useState(false);
  const hasName = Boolean(shopDisplayName(values));
  const message = submitted && !hasName ? "Enter a nickname or shop name." : error;

  return (
    <ScrollView
      style={ui.page}
      contentContainerStyle={ui.content}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text accessibilityRole="header" style={ui.title}>{editing ? "Edit shop" : "Add a shop"}</Text>
      <Text style={ui.body}>Enter a nickname, a shop name, or both.</Text>
      {fields.map(({ key, label, ...inputProps }) => (
        <View key={key} style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            {...inputProps}
            accessibilityLabel={label}
            autoCapitalize="words"
            editable={!isSubmitting}
            onChangeText={(text) => onChange({ ...values, [key]: text })}
            placeholderTextColor={color.muted}
            style={styles.input}
            value={values[key]}
          />
        </View>
      ))}
      {message ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {message}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
        disabled={isSubmitting}
        onPress={() => {
          setSubmitted(true);
          if (hasName) {
            Keyboard.dismiss();
            onSubmit(values);
          }
        }}
        style={[ui.button, isSubmitting && styles.disabled]}
      >
        <Text style={ui.buttonText}>{isSubmitting ? "Saving shop…" : editing ? "Save changes" : "Save shop"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={isSubmitting}
        onPress={() => {
          Keyboard.dismiss();
          onCancel();
        }}
        style={[ui.button, styles.cancel, isSubmitting && styles.disabled]}
      >
        <Text style={styles.label}>Cancel</Text>
      </Pressable>
      {onRemove ? (
        <Pressable accessibilityRole="button" disabled={isSubmitting} onPress={() => { Keyboard.dismiss(); onRemove(); }} style={styles.remove}>
          <Text style={styles.error}>Remove shop</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  remove: { minHeight: 44, padding: spacing.sm, alignItems: "center", justifyContent: "center" },
  error: { color: "#A22A23", fontSize: typography.body },
  cancel: { backgroundColor: color.mint },
  disabled: { opacity: 0.65 },
});
