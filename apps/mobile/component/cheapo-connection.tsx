import { useEffect, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { CheapoAccessError, type AccessState, type CheapoAccess } from "@/lib/cheapo-access/client";
import { color, radius, spacing, ui } from "./results/theme";

type Props = { access: Pick<CheapoAccess, "check" | "enroll" | "clear"> };
type Status = AccessState | "checking" | "storage-error";
const statusText: Record<Status, string> = {
  checking: "Checking this phone…",
  missing: "This phone is not connected.",
  connected: "This phone is connected.",
  denied: "Cheapo access ended. Ask your operator for a replacement credential.",
  unavailable: "Cheapo could not be reached. Check again when you’re online.",
  "storage-error": "Could not read this phone’s protected storage.",
};

export function CheapoConnection({ access }: Props) {
  const [status, setStatus] = useState<Status>("checking");
  const [credential, setCredential] = useState("");
  const [action, setAction] = useState<"enroll" | "clear" | null>(null);
  const [error, setError] = useState("");
  const busy = status === "checking" || action !== null;

  useEffect(() => {
    if (status !== "checking") return;
    let mounted = true;
    void access.check().then(
      (result) => { if (mounted) setStatus(result); },
      () => { if (mounted) setStatus("storage-error"); },
    );
    return () => { mounted = false; };
  }, [access, status]);

  async function enroll() {
    setAction("enroll");
    setError("");
    try {
      await access.enroll(credential);
      setCredential("");
      setStatus("connected");
    } catch (failure) {
      setError(failure instanceof CheapoAccessError ? failure.message : "Could not save to protected storage.");
    } finally {
      setAction(null);
    }
  }

  async function clear() {
    setAction("clear");
    setError("");
    try {
      await access.clear();
      setCredential("");
      setStatus("missing");
    } catch {
      setError("Could not clear this phone’s credential.");
    } finally {
      setAction(null);
    }
  }

  return (
    <ScrollView style={ui.page} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={ui.title}>Cheapo access</Text>
      <View style={ui.card}>
        <Text accessibilityLiveRegion="polite" style={ui.body}>{statusText[status]}</Text>
        {status === "unavailable" || status === "storage-error" ? (
          <Button title="Check again" disabled={busy} onPress={() => { setError(""); setStatus("checking"); }} />
        ) : null}
        <Text style={ui.body}>Device credential supplied by your operator</Text>
        <TextInput
          accessibilityLabel="Device credential"
          style={styles.input}
          value={credential}
          onChangeText={setCredential}
          editable={!busy}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          importantForAutofill="no"
          secureTextEntry
        />
        {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        <Button
          title={action === "enroll" ? "Connecting…" : status === "missing" ? "Connect this phone" : "Use new credential"}
          disabled={busy || !credential.trim()}
          onPress={() => void enroll()}
        />
        {status !== "missing" && status !== "checking" ? (
          <Button title={action === "clear" ? "Clearing…" : "Clear credential"} disabled={busy} onPress={() => void clear()} />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    color: color.ink,
    borderWidth: 1,
    borderColor: color.muted,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
  },
  error: { color: color.warningInk },
});
