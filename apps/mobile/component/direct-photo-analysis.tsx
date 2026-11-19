import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { File } from 'expo-file-system';

import type { AiPriceDraft } from '@/data/ai-observation';
import type { PhotoAsset } from '@/data/local-photo';
import { requestPhotoDraft } from '@/lib/direct-auth/photo-analysis';
import { phoneAuth } from '@/lib/direct-auth/phone-session';
import { PhotoAnalysisControls } from './photo-analysis-review';
import type { ReviewSuggestion } from './photo-review';

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

export function DirectPhotoAnalysis({ photo, busy, onApply, children }: {
  photo: PhotoAsset;
  busy: boolean;
  onApply: (draft: AiPriceDraft) => void;
  children: (controls: ReactNode, suggestion?: ReviewSuggestion) => ReactNode;
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
        const message = 'Suggestions ready. Check the details before applying.';
        setStatus(message);
        if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
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

  const controls = <PhotoAnalysisControls
    label={authState?.planAllowed ? working ? 'Analysing…' : 'Analyse photo' : 'Connect ChatGPT'}
    status={status}
    disabled={authState?.planAllowed ? busy || working || authState.busy : authState?.busy}
    onPress={() => {
      if (authState?.planAllowed) void analyse();
      else router.push('/direct-auth');
    }}
  />;

  return children(controls, draft ? {
    draft,
    onApply: selected => {
      onApply(selected);
      setDraft(undefined);
      setStatus('Suggestions added. Review or edit before saving.');
    },
  } : undefined);
}
