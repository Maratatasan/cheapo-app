import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { LegacyCleanupResult } from "../data/legacy-shopping-cleanup";
import { color, spacing, typography, ui } from "./results/theme";

type CacheControls = {
  measureBytes(): Promise<number>;
  clear(): Promise<void>;
};
type Measurement = { status: "loading" | "unavailable" } | { status: "ready"; bytes: number };
type Props = {
  cache: CacheControls;
  onBack: () => void;
  bottomInset?: number;
  legacyCleanup?: () => Promise<LegacyCleanupResult>;
};
type Cleanup = { status: "idle" | "confirming" | "clearing" | "blocked" }
  | { status: "finished"; result: LegacyCleanupResult };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  const units = ["B", "KB", "MB", "GB"];
  return `${Number((bytes / 1024 ** unit).toFixed(1))} ${units[unit]}`;
}

function PageButton({ title, onPress, secondary, disabled = false }: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[ui.button, secondary && styles.secondary, disabled && styles.disabled]}
    >
      <Text style={[ui.buttonText, secondary && styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}

export function StorageCache({ cache, onBack, bottomInset = 0, legacyCleanup }: Props) {
  const [measurement, setMeasurement] = useState<Measurement>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const clearPending = useRef(false);
  const [cleanup, setCleanup] = useState<Cleanup>({ status: "idle" });
  const cleanupPending = useRef(false);
  const bytes = measurement.status === "ready" ? measurement.bytes : undefined;

  useEffect(() => {
    let active = true;
    void cache.measureBytes().then(
      measured => {
        if (!active) return;
        setMeasurement(Number.isSafeInteger(measured) && measured >= 0
          ? { status: "ready", bytes: measured }
          : { status: "unavailable" });
      },
      () => { if (active) setMeasurement({ status: "unavailable" }); },
    );
    return () => { active = false; };
  }, [attempt, cache]);

  function remeasure() {
    setMeasurement({ status: "loading" });
    setAttempt(current => current + 1);
  }

  async function confirmClear() {
    if (!confirming || clearPending.current) return;
    clearPending.current = true;
    setConfirming(false);
    setClearing(true);
    setClearFailed(false);
    try {
      await cache.clear();
    } catch {
      setClearFailed(true);
    } finally {
      clearPending.current = false;
      setClearing(false);
      remeasure();
    }
  }

  async function confirmLegacyCleanup() {
    if (!legacyCleanup || cleanup.status !== "confirming" || cleanupPending.current) return;
    cleanupPending.current = true;
    setCleanup({ status: "clearing" });
    try {
      setCleanup({ status: "finished", result: await legacyCleanup() });
    } catch {
      setCleanup({ status: "blocked" });
    } finally {
      cleanupPending.current = false;
    }
  }

  return (
    <View style={ui.page}>
      <ScrollView style={ui.page} contentContainerStyle={ui.content} contentInsetAdjustmentBehavior="automatic">
        <View style={ui.card}>
          <Text accessibilityRole="header" style={styles.heading}>Downloaded copies</Text>
          <Text accessibilityLiveRegion="polite" style={bytes === undefined || clearing ? ui.body : styles.amount}>
            {clearing ? "Clearing cache…" : bytes !== undefined ? formatBytes(bytes)
              : measurement.status === "loading" ? "Measuring cache…" : "Cache size unavailable."}
          </Text>
          {bytes === 0 ? <Text style={ui.body}>No downloaded copies on this phone.</Text> : null}
          {clearFailed ? <Text accessibilityRole="alert" style={styles.warning}>Could not clear the cache. Try again.</Text> : null}
          {confirming ? (
            <View style={styles.confirmation}>
              <Text accessibilityRole="header" style={styles.heading}>Clear downloaded copies?</Text>
              <Text accessibilityLiveRegion="polite" style={ui.body}>
                Cleared copies are unavailable offline until Cheapo fetches them again. Your server records stay available.
              </Text>
              <PageButton title="Clear downloaded copies" onPress={() => void confirmClear()} />
              <PageButton title="Cancel" secondary onPress={() => setConfirming(false)} />
            </View>
          ) : measurement.status === "unavailable" ? (
            <PageButton title="Measure again" secondary onPress={remeasure} />
          ) : (
            <PageButton title="Clear cache" secondary disabled={clearing || bytes === undefined || bytes === 0}
              onPress={() => { setClearFailed(false); setConfirming(true); }} />
          )}
        </View>
        <View style={ui.card}>
          <Text accessibilityRole="header" style={styles.heading}>Protected on-device data</Text>
          <Text style={ui.body}>
            Saved shopping records, original photos, device credentials, pending changes and conflict copies use separate storage.
          </Text>
        </View>
        {legacyCleanup ? <View style={ui.card}>
          <Text accessibilityRole="header" style={styles.heading}>Old phone-only shopping data</Text>
          {cleanup.status === "confirming" ? <View style={styles.confirmation}>
            <Text accessibilityRole="header" style={styles.heading}>Remove old phone data?</Text>
            <Text style={ui.body}>This removes reviewed phone-only prices and their photos, old saved shops, and barcode matches that are safe to remove.
              Shared history, unfinished drafts, pending work, sign-ins, exports, and the phone gallery are kept.</Text>
            <PageButton title="Remove old records" onPress={() => void confirmLegacyCleanup()} />
            <PageButton title="Cancel removal" secondary onPress={() => setCleanup({ status: "idle" })} />
          </View> : <>
            {cleanup.status === "finished" ? <>
              <Text accessibilityLiveRegion="polite" style={ui.body}>
                Removed {cleanup.result.removedPrices} old price records. Kept {cleanup.result.keptPrices} protected prices or drafts.
              </Text>
              {cleanup.result.savedShopsCleared ? <Text style={ui.body}>Old saved shops were cleared.</Text> : null}
              {cleanup.result.barcodeCatalog === "kept" ? <Text style={ui.body}>Old barcode matches were kept for retained prices.</Text> : null}
              {cleanup.result.barcodeCatalog === "cleared" ? <Text style={ui.body}>Old barcode matches were cleared.</Text> : null}
              {cleanup.result.failedParts > 0 ? <Text accessibilityRole="alert" style={styles.warning}>
                Some old data could not be removed. Try again to finish.
              </Text> : null}
            </> : null}
            {cleanup.status === "blocked" ? <Text accessibilityRole="alert" style={styles.warning}>
              Could not verify protected shopping data. No old data was removed.
            </Text> : null}
            <PageButton title={cleanup.status === "clearing" ? "Removing old records…" : "Remove old phone data"}
              secondary disabled={cleanup.status === "clearing"} onPress={() => setCleanup({ status: "confirming" })} />
          </>}
        </View> : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: spacing.md + bottomInset }]}>
        <PageButton title="Back to Home" secondary disabled={cleanup.status === "clearing"} onPress={onBack} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: typography.section, fontWeight: "700", color: color.ink },
  amount: { fontSize: typography.price, fontWeight: "800", color: color.ink },
  secondary: { backgroundColor: color.mint },
  secondaryText: { color: color.green },
  disabled: { opacity: 0.5 },
  warning: { color: color.warningInk, fontSize: typography.body },
  confirmation: { gap: spacing.md, paddingTop: spacing.sm },
  footer: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});
