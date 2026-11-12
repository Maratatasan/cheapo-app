import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { cropToPixels, type CropBox } from '@/data/crop-geometry';
import { localPhotoSource, type PhotoAsset } from '@/data/local-photo';

/** Produce a separate JPEG while keeping the captured original intact. */
export async function cropPhoto(original: PhotoAsset, box: CropBox): Promise<PhotoAsset> {
  const source = await localPhotoSource(original);
  const context = ImageManipulator.manipulate(source.uri);
  try {
    context.crop(cropToPixels(box, original));
    const image = await context.renderAsync();
    try {
      const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
      return { uri: result.uri, width: result.width, height: result.height, mimeType: 'image/jpeg' };
    } finally { image.release(); }
  } finally { context.release(); }
}
