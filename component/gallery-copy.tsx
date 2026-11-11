import { useRef, useState } from 'react';
import { Alert, Button } from 'react-native';
import type { PhotoAsset } from '@/data/local-photo';
import { saveGalleryCopy } from '@/lib/photo-gallery';

export function GalleryCopy({ photo }: { photo: PhotoAsset }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (pending.current || copied) return;
    pending.current = true; setBusy(true);
    try { await saveGalleryCopy(photo); setCopied(true); }
    catch (error) { Alert.alert('Gallery copy not saved', `${error instanceof Error ? error.message : 'Try again.'} The original and saved draft remain in Cheapo.`); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Button title={busy ? 'Copying to phone gallery…' : copied ? 'Gallery copy saved' : 'Save copy to phone gallery'} disabled={busy || copied} onPress={copy} />;
}
