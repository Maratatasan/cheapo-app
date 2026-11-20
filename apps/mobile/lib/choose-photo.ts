import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { PhotoAsset } from '@/data/local-photo';
import { originalPhotoDate } from '@/data/price-observed-date';

export async function choosePhoto(): Promise<PhotoAsset | undefined> {
  return toPhotoAsset(await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: true }));
}

export async function takePhoto(): Promise<PhotoAsset | 'camera-denied' | undefined> {
  if (!(await requestCameraPermissionsAsync()).granted) return 'camera-denied';
  return toPhotoAsset(await launchCameraAsync({ mediaTypes: ['images'], quality: 1 }));
}

async function toPhotoAsset(result: Awaited<ReturnType<typeof launchImageLibraryAsync>>): Promise<PhotoAsset | undefined> {
  if (result.canceled) return undefined;
  const asset = result.assets[0];
  if (!asset?.uri) throw new Error('Photo selection was unavailable.');
  const date = originalPhotoDate(asset.exif?.DateTimeOriginal, asset.exif?.OffsetTimeOriginal, asset.exif?.SubsecTimeOriginal);

  if (asset.mimeType === 'image/jpeg' && asset.width > 0 && asset.height > 0) {
    return { uri: asset.uri, width: asset.width, height: asset.height, mimeType: 'image/jpeg', ...date };
  }

  const context = ImageManipulator.manipulate(asset.uri);
  try {
    const image = await context.renderAsync();
    try {
      const jpeg = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
      return { uri: jpeg.uri, width: jpeg.width, height: jpeg.height, mimeType: 'image/jpeg', ...date };
    } finally { image.release(); }
  } finally { context.release(); }
}
