import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { color, spacing, typography, ui } from "./results/theme";

type CacheControls = {
  measureBytes(): Promise<number>;
  clear(): Promise<void>;
};
type Measurement = { status: "loading" | "unavailable" } | { status: "ready"; bytes: number };
type Props = { cache: CacheControls; onBack: () => void; bottomInset?: number };

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

export function StorageCache({ cache, onBack, bottomInset = 0 }: Props) {
  const [measurement, setMeasurement] = useState<Measurement>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const clearPending = useRef(false);
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
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: spacing.md + bottomInset }]}>
        <PageButton title="Back to Home" secondary onPress={onBack} />
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
