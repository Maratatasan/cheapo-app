import { File } from 'expo-file-system';

import type { RenderSelectedCrop } from '@/data/selected-price-photo-read';
import { cropPhoto } from '@/lib/photo-crop';

export const renderSelectedPriceCrop: RenderSelectedCrop = async (original, box) => {
  const source = new File(original.uri);
  if ((await source.digest('SHA-256')).toLowerCase() !== original.sha256) {
    throw Error('The saved original photo could not be verified.');
  }
  const crop = await cropPhoto({ ...original, mimeType: 'image/jpeg' }, box);
  const file = new File(crop.uri);
  try {
    const [bytes, sha256] = await Promise.all([file.bytes(), file.digest('SHA-256')]);
    return { bytes, sha256: sha256.toLowerCase(), width: crop.width, height: crop.height };
  } finally {
    if (crop.uri !== original.uri && file.exists) {
      try { file.delete(); } catch { /* A temporary derived image may already have been removed. */ }
    }
  }
};
