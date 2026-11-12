import { launchImageLibraryAsync } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { PhotoAsset } from '@/data/local-photo';

export async function choosePhoto(): Promise<PhotoAsset | undefined> {
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled) return undefined;
  const asset = result.assets[0];
  if (!asset?.uri) throw new Error('Photo selection was unavailable.');

  if (asset.mimeType === 'image/jpeg' && asset.width > 0 && asset.height > 0) {
    return { uri: asset.uri, width: asset.width, height: asset.height, mimeType: 'image/jpeg' };
  }

  const context = ImageManipulator.manipulate(asset.uri);
  try {
    const image = await context.renderAsync();
    try {
      const jpeg = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
      return { uri: jpeg.uri, width: jpeg.width, height: jpeg.height, mimeType: 'image/jpeg' };
    } finally { image.release(); }
  } finally { context.release(); }
}
