import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/** Top-left origin, normalized to the upright image dimensions. */
export type PhotoTextBox = readonly [left: number, top: number, right: number, bottom: number];
export type PhotoTextElement = { text: string; box?: PhotoTextBox };
export type PhotoTextLine = { text: string; box?: PhotoTextBox; elements: readonly PhotoTextElement[] };
export type PhotoTextBlock = { lines: readonly PhotoTextLine[] };
export type PhotoTextEvidence = { width: number; height: number; blocks: readonly PhotoTextBlock[] };
export type PhotoTextResult =
  | { status: 'found'; evidence: PhotoTextEvidence }
  | { status: 'empty' | 'unavailable' | 'error' | 'aborted' };

type NativePhotoText = { read(uri: string): Promise<PhotoTextEvidence> };

/** One still photo or selected crop. The caller aborts when that selection changes. */
export async function readPhotoText(uri: string, signal?: AbortSignal): Promise<PhotoTextResult> {
  if (signal?.aborted) return { status: 'aborted' };
  if (Platform.OS !== 'android' || !/^(file:\/\/\/[^\s]|content:\/\/[^/\s])/.test(uri)) {
    return { status: 'unavailable' };
  }

  let onAbort: (() => void) | undefined;
  try {
    const module = requireOptionalNativeModule<NativePhotoText>('CheapoPhotoText');
    if (!module) return { status: 'unavailable' };

    const recognition = module.read(uri);
    const evidence = signal ? await Promise.race([
      recognition,
      new Promise<undefined>(resolve => {
        onAbort = () => resolve(undefined);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]) : await recognition;
    if (signal?.aborted || !evidence) return { status: 'aborted' };
    return evidence.blocks.length ? { status: 'found', evidence } : { status: 'empty' };
  } catch {
    return { status: signal?.aborted ? 'aborted' : 'error' };
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
