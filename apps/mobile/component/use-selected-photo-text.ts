import { useEffect, useState } from 'react';
import type { PhotoAsset } from '@/data/local-photo';
import { readPhotoText, type SelectedPhotoText } from '@/data/photo-text';

// The JS abort returns before native recognition releases its image resources.
// Wait for the previous native call even if its review has already unmounted.
let pendingRecognition = Promise.resolve();

export function useSelectedPhotoText(photo: PhotoAsset | undefined): SelectedPhotoText | undefined {
  const [snapshot, setSnapshot] = useState<SelectedPhotoText>();
  useEffect(() => {
    setSnapshot(undefined);
    if (!photo) return;

    let active = true;
    pendingRecognition = pendingRecognition.then(async () => {
      if (!active) return;
      const result = await readPhotoText(photo.uri);
      if (active) setSnapshot({ photo, result });
    });
    return () => { active = false; };
  }, [photo]);
  return snapshot?.photo === photo ? snapshot : undefined;
}
