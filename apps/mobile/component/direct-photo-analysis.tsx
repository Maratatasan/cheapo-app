import { useEffect, useRef, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { File } from 'expo-file-system';

import type { AiPriceDraft } from '@/data/ai-observation';
import type { PhotoAsset } from '@/data/local-photo';
import { requestPhotoDraft } from '@/lib/direct-auth/photo-analysis';
import { phoneAuth } from '@/lib/direct-auth/phone-session';
import { AiDraftCard } from './results/ai-draft-card';

async function photoDataUrl(photo: PhotoAsset): Promise<string> {
  if (!photo.uri.startsWith('file:')) throw new Error('Choose or take a photo on this phone first.');
  let file: File;
  try { file = new File(photo.uri); }
  catch { throw new Error('Could not read the selected photo.'); }
  if (!file.exists || !file.size) throw new Error('Could not read the selected photo.');
  if (file.size > 5_900_000) throw new Error('Crop the photo to a smaller area before analysing it.');
  try { return `data:image/jpeg;base64,${await file.base64()}`; }
  catch { throw new Error('Could not read the selected photo.'); }
}

export function DirectPhotoAnalysis({ photo, busy, onApply }: {
  photo: PhotoAsset;
  busy: boolean;
  onApply: (draft: AiPriceDraft) => void;
}) {
  const router = useRouter();
  const [authState, setAuthState] = useState(phoneAuth?.getState);
  const [draft, setDraft] = useState<AiPriceDraft>();
  const [status, setStatus] = useState<string>();
  const [working, setWorking] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const unsubscribe = phoneAuth?.subscribe(setAuthState);
    void phoneAuth?.restore();
    return () => {
      unsubscribe?.();
      const pending = request.current;
      request.current = null;
      pending?.abort();
    };
  }, []);

  async function analyse() {
    if (!phoneAuth || request.current || busy) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);
    setWorking(true);
    setDraft(undefined);
    setStatus('Analysing the selected photo…');
    try {
      const image = await photoDataUrl(photo);
      if (controller.signal.aborted) return;
      const suggestion = await phoneAuth.withPlanAccess((accessToken) => {
        if (controller.signal.aborted) throw new Error('Photo analysis was cancelled.');
        return requestPhotoDraft({ accessToken, image, signal: controller.signal });
      });
      if (!controller.signal.aborted) {
        setDraft(suggestion);
        setStatus('Check these suggestions against the photo.');
      }
    } catch (error) {
      if (request.current === controller) {
        setStatus(controller.signal.aborted ? 'Photo analysis stopped. You can retry or enter details manually.'
          : error instanceof Error ? error.message : 'Photo analysis failed. You can still enter details manually.');
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setWorking(false);
      }
    }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.text}>Analyse photo sends only the selected photo to OpenAI using your ChatGPT plan.</Text>
      {authState?.planAllowed ? (
        <Button title={working ? 'Analysing…' : 'Analyse photo'} disabled={busy || working || authState.busy} onPress={analyse} />
      ) : <Button title="Connect ChatGPT" disabled={authState?.busy} onPress={() => router.push('/direct-auth')} />}
      {status ? <Text accessibilityLiveRegion="polite" style={styles.text}>{status}</Text> : null}
      {draft ? <>
        <AiDraftCard draft={draft} />
        {draft.productType ? <Text style={styles.text}>Product type: {draft.productType}</Text> : null}
        {draft.variety ? <Text style={styles.text}>Variety: {draft.variety}</Text> : null}
        <Button title="Use suggested details" disabled={busy} onPress={() => { onApply(draft); setDraft(undefined); setStatus('Suggestions added. Review or edit before saving.'); }} />
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 8, marginBottom: 8 },
  text: { color: '#ddd', fontSize: 13 },
});
