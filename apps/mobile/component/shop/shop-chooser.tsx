import { useEffect, useRef, useState } from "react";
import { Button, Text, View } from "react-native";
import { normalizeName, shopDisplayName } from "@cheapo/domain/names";

import { ui } from "@/component/results/theme";
import type { Shop } from "@cheapo/domain";
import type { SavedShopState, SavedShopSync, ShopCandidateSearch, ShopEditBase, ShopRepository } from "@/data/shop-repository";
import { ShopBranchConfirmation } from "./shop-branch-confirmation";
import { ShopForm, type ShopFormValues } from "./shop-form";
import { ShopPicker } from "./shop-picker";
import { ShopRemovalConfirmation } from "./shop-removal-confirmation";

type ShopChooserProps = {
  state: SavedShopState;
  actions: Pick<ShopRepository, "saveShop" | "selectShop" | "findShopCandidates">;
  management?: Pick<ShopRepository, "updateShop" | "removeShop"> & {
    onChanged: (state: SavedShopState) => void;
  };
  onSelected: (state: SavedShopState) => void;
  onCancel: () => void;
};

const emptyForm = { nickname: "", name: "", address: "" };

export function ShopChooser({ state, actions, management, onSelected, onCancel }: ShopChooserProps) {
  const [form, setForm] = useState<ShopFormValues>();
  const [editing, setEditing] = useState<Shop>();
  const [editingBase, setEditingBase] = useState<ShopEditBase>();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [candidates, setCandidates] = useState<ShopCandidateSearch>();
  const pending = useRef(false);
  const search = useRef<AbortController | null>(null);
  useEffect(() => () => search.current?.abort(), []);

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
    search.current?.abort();
    search.current = null;
    setChecking(false);
    setCandidates(undefined);
    setError(undefined);
    setForm(undefined);
    setEditing(undefined);
    setEditingBase(undefined);
    setConfirmingRemoval(false);
  }

  function applyChanges(next: SavedShopState) {
    management?.onChanged(next);
    closeForm();
  }

  async function checkBranches(values: ShopFormValues) {
    if (!actions.findShopCandidates || search.current) return;
    const request = new AbortController();
    search.current = request;
    setChecking(true);
    try {
      const result = await actions.findShopCandidates({ name: values.name, address: values.address }, request.signal);
      if (!request.signal.aborted) setCandidates(result);
    } catch {
      if (!request.signal.aborted) setCandidates({ status: 'unavailable', shops: [] });
    } finally {
      if (search.current === request) {
        search.current = null;
        setChecking(false);
      }
    }
  }

  if (confirmingRemoval && editing && management) {
    return <ShopRemovalConfirmation
      name={shopDisplayName(editing) ?? "this shop"}
      isCurrent={editing.id === state.currentShop?.id}
      busy={saving}
      error={error}
      onConfirm={() => perform(() => editingBase
        ? management.removeShop(editing.id, editingBase)
        : management.removeShop(editing.id), applyChanges)}
      onCancel={() => { setError(undefined); setConfirmingRemoval(false); }}
    />;
  }

  if (form && candidates) return <ShopBranchConfirmation result={candidates} busy={saving} error={error}
    onUse={candidate => {
      if (state.shops.some(shop => shop.id === candidate.id)) {
        void perform(() => actions.selectShop(candidate.id));
      } else {
        const nickname = normalizeName(form.nickname) ?? (candidate.name ? undefined : normalizeName(form.name));
        void perform(() => actions.saveShop({ ...candidate, nickname }, { select: true }));
      }
    }}
    onCreate={() => { void perform(() => actions.saveShop({ ...form, address: normalizeName(form.address) }, { select: true })); }}
    onBack={() => { setCandidates(undefined); setError(undefined); }} />;

  if (form) {
    return (
      <ShopForm
        values={form}
        editing={!!editing}
        isSubmitting={saving || checking}
        submitLabel={!editing && actions.findShopCandidates ? "Check shared shops" : undefined}
        busyLabel={checking ? "Checking shared shops…" : undefined}
        canCancelWhileBusy={checking}
        error={error}
        onChange={(values) => { setError(undefined); setForm(values); }}
        onSubmit={(values) => {
          const details = { ...values, address: normalizeName(values.address) };
          if (editing && management) {
            void perform(() => editingBase
              ? management.updateShop(editing.id, details, editingBase)
              : management.updateShop(editing.id, details), applyChanges);
          } else if (actions.findShopCandidates) {
            void checkBranches(values);
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
      <ShopSyncFeedback sync={state.sync} />
      <ShopPicker
        shops={state.shops}
        selectedShopId={state.currentShop?.id}
        isLoading={saving}
        onSelect={({ id }) => perform(() => actions.selectShop(id))}
        onEditShop={management ? shop => {
          if (pending.current) return;
          setError(undefined);
          setEditing(shop);
          setEditingBase(state.editBases?.get(shop.id));
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

export function ShopSyncFeedback({ sync }: { sync?: SavedShopSync }) {
  if (!sync) return null;
  return <Text accessibilityLiveRegion="polite" style={ui.small}>
    {sync.status === 'unavailable' ? 'Saved shops are unavailable offline. You can add a shop.'
      : `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}`}
  </Text>;
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
