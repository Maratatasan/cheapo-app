import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PhotoAsset } from '../data/local-photo';
import type { createProductPresentationPhotos, PreparedProductPhoto } from '../data/product-presentation-photos';
import type { chooseProductPhoto } from '../lib/choose-product-photo';
import { CameraActionButton } from './camera-actions';
import { color, radius, spacing, ui } from './results/theme';

type Props = {
  productId: string;
  photos: ReturnType<typeof createProductPresentationPhotos>;
  choose: typeof chooseProductPhoto;
  subscribeClear?: (listener: () => void) => () => void;
  onSavingChange?: (saving: boolean) => void;
  disabled?: boolean;
};
type CurrentPhoto = { version: number; uri?: string };
type Candidate = { asset: PhotoAsset; plan?: PreparedProductPhoto };

export function ProductPhotoEditor({ productId, photos, choose, subscribeClear, onSavingChange, disabled }: Props) {
  const [current, setCurrent] = useState<CurrentPhoto>();
  const [checking, setChecking] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [candidate, setCandidate] = useState<Candidate>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState(false);
  const scope = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const requiredVersion = useRef(0);

  const refresh = useCallback(async (signal: AbortSignal, initial = false) => {
    setChecking(true);
    try {
      if (initial) {
        const cached = await photos.read(productId, signal, 'cache-only');
        if (!signal.aborted && (cached.status === 'fresh' || cached.status === 'cached')) setCurrent(cached.photo);
      }
      const result = await photos.read(productId, signal);
      if (signal.aborted) return;
      if (result.status === 'fresh' || result.status === 'cached') setCurrent(result.photo);
      else if (result.status === 'missing') setCurrent({ version: 0 });
    } catch {
      if (!signal.aborted) setCurrent(undefined);
    } finally { if (!signal.aborted) setChecking(false); }
  }, [photos, productId]);

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    const unsubscribe = subscribeClear?.(() => setCurrent(undefined));
    void refresh(controller.signal, true);
    return () => { controller.abort(); unsubscribe?.(); scope.current = null; };
  }, [refresh, subscribeClear]);

  async function pick(source: 'camera' | 'library') {
    const signal = scope.current?.signal;
    if (!signal || busy.current || disabled) return;
    busy.current = true;
    setPicking(true);
    setMessage(undefined);
    setError(false);
    try {
      const result = await choose(source);
      if (signal.aborted) return;
      if (result === 'camera-denied') {
        setError(true);
        setMessage('Allow camera access or choose a photo from your phone.');
      } else if (result) setCandidate({ asset: result });
    } catch {
      if (!signal.aborted) {
        setError(true);
        setMessage('Could not open that photo. Try another.');
      }
    } finally {
      busy.current = false;
      if (!signal.aborted) setPicking(false);
    }
  }

  async function confirm() {
    const signal = scope.current?.signal;
    if (!signal || !current || !candidate || current.version < requiredVersion.current || checking || busy.current || disabled) return;
    busy.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setMessage(undefined);
    setError(false);
    try {
      const plan = candidate.plan ?? await photos.prepare(productId, current.version, candidate.asset, signal);
      if (signal.aborted) return;
      setCandidate({ ...candidate, plan });
      const result = await photos.replace(plan, signal);
      if (signal.aborted) return;
      if (result.status === 'available') {
        setCurrent({ version: result.version, uri: candidate.asset.uri });
        setCandidate(undefined);
        setChoosing(false);
        setMessage('Product photo saved.');
      } else if (result.status === 'conflict') {
        requiredVersion.current = result.currentVersion;
        setCandidate({ asset: candidate.asset });
        setError(true);
        setMessage('The shared photo changed. Review the current photo before saving again.');
        await refresh(signal);
      } else {
        if (result.status === 'blocked') setCandidate({ asset: candidate.asset });
        setError(true);
        setMessage('Could not save this product photo. Your previous photo is still available.');
      }
    } catch {
      if (!signal.aborted) {
        setError(true);
        setMessage('Could not save this product photo. Try again when Cheapo is available.');
      }
    } finally {
      busy.current = false;
      onSavingChange?.(false);
      if (!signal.aborted) setSaving(false);
    }
  }

  function cancel() {
    setChoosing(false);
    setCandidate(undefined);
    setMessage(undefined);
    setError(false);
  }

  const locked = Boolean(disabled || picking || saving);
  const ready = current && current.version >= requiredVersion.current && !checking;
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={styles.title}>Product photo</Text>
    <View style={styles.frame}>
      {current?.uri ? <Image source={{ uri: current.uri }} accessibilityLabel="Current product photo" resizeMode="contain" style={styles.photo} />
        : <Text style={ui.body}>{checking ? 'Checking the product photo…' : ready ? 'No product photo yet' : 'Product photo unavailable'}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Change product photo" accessibilityState={{ disabled: locked || !ready }}
        disabled={locked || !ready} style={[styles.camera, (locked || !ready) && styles.disabled]}
        onPress={() => { setChoosing(true); setMessage(undefined); setError(false); }}>
        <View style={styles.iconBody}><View style={styles.iconTop} /><View style={styles.iconLens} /></View>
      </Pressable>
    </View>
    {!ready && !checking ? <CameraActionButton label="Check photo again" disabled={locked}
      onPress={() => { if (scope.current) void refresh(scope.current.signal); }} /> : null}
    {choosing && !candidate ? <View style={styles.actions}>
      <CameraActionButton label="Take photo" disabled={locked} onPress={() => { void pick('camera'); }} />
      <CameraActionButton label="Choose from phone" disabled={locked} onPress={() => { void pick('library'); }} />
      <CameraActionButton label="Cancel photo change" disabled={locked} onPress={cancel} />
    </View> : null}
    {candidate ? <View style={styles.actions}>
      <Text accessibilityRole="header" style={styles.title}>Preview new product photo</Text>
      <Image source={{ uri: candidate.asset.uri }} accessibilityLabel="New product photo preview" resizeMode="contain" style={styles.preview} />
      <CameraActionButton label={saving ? 'Saving photo…' : 'Save product photo'} primary busy={saving}
        disabled={locked || !ready} onPress={() => { void confirm(); }} />
      <CameraActionButton label="Cancel photo change" disabled={locked} onPress={cancel} />
    </View> : null}
    {message ? <Text accessibilityLiveRegion="polite" accessibilityRole={error ? 'alert' : undefined} style={error ? styles.warning : ui.body}>
      {message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', color: color.ink },
  frame: { height: 146, borderRadius: radius.control, backgroundColor: color.mint, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 48 },
  photo: { position: 'absolute', width: '100%', height: '100%' },
  camera: { position: 'absolute', right: spacing.sm, bottom: spacing.sm, width: 48, height: 48,
    borderRadius: 24, backgroundColor: 'rgba(24,61,50,0.82)', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  iconBody: { width: 24, height: 16, borderWidth: 2, borderColor: color.white, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center' },
  iconTop: { position: 'absolute', top: -5, left: 6, width: 9, height: 4, borderRadius: 2, backgroundColor: color.white },
  iconLens: { width: 8, height: 8, borderWidth: 2, borderRadius: 4, borderColor: color.white },
  actions: { gap: spacing.sm },
  preview: { width: '100%', height: 148, borderRadius: radius.control, backgroundColor: color.mint },
  warning: { ...ui.body, color: color.warningInk },
});
