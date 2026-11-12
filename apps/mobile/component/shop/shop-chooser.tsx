import { useRef, useState } from "react";
import { Button, Text, View } from "react-native";
import { normalizeName, shopDisplayName } from "@cheapo/domain/names";

import { ui } from "@/component/results/theme";
import type { Shop } from "@cheapo/domain";
import type { SavedShopState, removeShop, saveShop, selectShop, updateShop } from "@/data/local-shops";
import { ShopForm, type ShopFormValues } from "./shop-form";
import { ShopPicker } from "./shop-picker";
import { ShopRemovalConfirmation } from "./shop-removal-confirmation";

type ShopChooserProps = {
  state: SavedShopState;
  actions: { saveShop: typeof saveShop; selectShop: typeof selectShop };
  management?: {
    updateShop: typeof updateShop;
    removeShop: typeof removeShop;
    onChanged: (state: SavedShopState) => void;
  };
  onSelected: (state: SavedShopState) => void;
  onCancel: () => void;
};

const emptyForm = { nickname: "", name: "", address: "" };

export function ShopChooser({ state, actions, management, onSelected, onCancel }: ShopChooserProps) {
  const [form, setForm] = useState<ShopFormValues>();
  const [editing, setEditing] = useState<Shop>();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  async function perform(operation: () => Promise<SavedShopState>, onSuccess = onSelected) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(undefined);
    try {
      onSuccess(await operation());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your shop. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  function closeForm() {
    setError(undefined);
    setForm(undefined);
    setEditing(undefined);
    setConfirmingRemoval(false);
  }

  function applyChanges(next: SavedShopState) {
    management?.onChanged(next);
    closeForm();
  }

  if (confirmingRemoval && editing && management) {
    return <ShopRemovalConfirmation
      name={shopDisplayName(editing) ?? "this shop"}
      isCurrent={editing.id === state.currentShop?.id}
      busy={saving}
      error={error}
      onConfirm={() => perform(() => management.removeShop(editing.id), applyChanges)}
      onCancel={() => { setError(undefined); setConfirmingRemoval(false); }}
    />;
  }

  if (form) {
    return (
      <ShopForm
        values={form}
        editing={!!editing}
        isSubmitting={saving}
        error={error}
        onChange={(values) => { setError(undefined); setForm(values); }}
        onSubmit={(values) => {
          const details = { ...values, address: normalizeName(values.address) };
          if (editing && management) {
            void perform(() => management.updateShop(editing.id, details), applyChanges);
          } else {
            void perform(() => actions.saveShop(details, { select: true }));
          }
        }}
        onRemove={editing && management ? () => { setError(undefined); setConfirmingRemoval(true); } : undefined}
        onCancel={closeForm}
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
        onSelect={({ id }) => perform(() => actions.selectShop(id))}
        onEditShop={management ? shop => {
          if (pending.current) return;
          setError(undefined);
          setEditing(shop);
          setForm({ nickname: shop.nickname ?? "", name: shop.name ?? "", address: shop.address ?? "" });
        } : undefined}
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
