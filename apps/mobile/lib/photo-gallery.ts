import { Platform } from 'react-native';
import type { PhotoAsset } from '@/data/local-photo';

/** Explicit, write-only copy. The app's original and draft remain private and unchanged. */
export async function saveGalleryCopy(photo: PhotoAsset): Promise<string> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw Error('Phone gallery copies are available in the mobile app.');
  if (!photo.uri.startsWith('file:') || photo.mimeType !== 'image/jpeg') throw Error('Save the selected JPEG on this phone first.');
  const { Asset, requestPermissionsAsync } = require('expo-media-library') as typeof import('expo-media-library');
  // Android 11+ creates app-owned MediaStore entries without reading the gallery.
  // iOS and older Android need add/write permission, requested only by this action.
  if (Platform.OS === 'ios' || Number(Platform.Version) < 30) {
    const permission = await requestPermissionsAsync(true, []);
    if (!permission.granted) throw Error('Phone gallery permission was not granted. Your Cheapo photo is still saved.');
  }
  const asset = await Asset.create(photo.uri);
  if (!asset.id) throw Error('The phone did not confirm the gallery copy. Your Cheapo photo is still saved.');
  return asset.id;
}
