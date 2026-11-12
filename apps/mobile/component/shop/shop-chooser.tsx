import { useRef, useState } from "react";
import { Button, Text, View } from "react-native";
import { normalizeName } from "@cheapo/domain/names";

import { ui } from "@/component/results/theme";
import { saveShop, selectShop, type SavedShopState } from "@/data/local-shops";
import { ShopForm, type ShopFormValues } from "./shop-form";
import { ShopPicker } from "./shop-picker";

type ShopChooserProps = {
  state: SavedShopState;
  onSelected: (state: SavedShopState) => void;
  onCancel: () => void;
};

const emptyForm = { nickname: "", name: "", address: "" };

export function ShopChooser({ state, onSelected, onCancel }: ShopChooserProps) {
  const [form, setForm] = useState<ShopFormValues>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  async function choose(operation: () => Promise<SavedShopState>) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(undefined);
    try {
      onSelected(await operation());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your shop. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  if (form) {
    return (
      <ShopForm
        values={form}
        isSubmitting={saving}
        error={error}
        onChange={(values) => { setError(undefined); setForm(values); }}
        onSubmit={(values) => choose(() => saveShop({
          ...values,
          address: normalizeName(values.address),
        }, { select: true }))}
        onCancel={() => { setError(undefined); setForm(undefined); }}
      />
    );
  }

  return (
    <View style={ui.page}>
      {error ? <Text accessibilityRole="alert" style={ui.content}>{error}</Text> : null}
      <ShopPicker
        shops={state.shops}
        selectedShopId={state.currentShop?.id}
        isLoading={saving}
        onSelect={({ id }) => choose(() => selectShop(id))}
        onAddShop={() => {
          if (pending.current) return;
          setError(undefined);
          setForm(emptyForm);
        }}
        onCancel={() => { if (!pending.current) onCancel(); }}
      />
    </View>
  );
}

export function ShopLoadFeedback({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <View style={ui.content}>
      <Text accessibilityRole={error ? "alert" : undefined} accessibilityLiveRegion="polite" style={ui.body}>
        {error ?? "Loading saved shops…"}
      </Text>
      {error ? <Button title="Try again" onPress={onRetry} /> : null}
    </View>
  );
}
