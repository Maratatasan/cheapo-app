import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { PhotoAsset } from '../data/local-photo';

export async function chooseProductPhoto(source: 'camera' | 'library'): Promise<PhotoAsset | 'camera-denied' | undefined> {
  if (source === 'camera' && !(await requestCameraPermissionsAsync()).granted) return 'camera-denied';
  const result = await (source === 'camera' ? launchCameraAsync : launchImageLibraryAsync)({ mediaTypes: ['images'] });
  if (result.canceled) return;
  const selected = result.assets[0];
  if (!selected?.uri || selected.width < 1 || selected.height < 1) throw Error('The selected photo is unavailable.');

  const context = ImageManipulator.manipulate(selected.uri);
  try {
    const longestSide = 1920;
    if (Math.max(selected.width, selected.height) > longestSide) {
      context.resize(selected.width >= selected.height ? { width: longestSide } : { height: longestSide });
    }
    const image = await context.renderAsync();
    try {
      const file = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.87 });
      return { uri: file.uri, width: file.width, height: file.height, mimeType: 'image/jpeg' };
    } finally { image.release(); }
  } finally { context.release(); }
}
