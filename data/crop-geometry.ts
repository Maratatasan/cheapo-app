export type CropBox = { left: number; top: number; right: number; bottom: number };
export type CropDrag = 'move' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const fullPhoto: CropBox = { left: 0, top: 0, right: 1, bottom: 1 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Coordinates are fractions of the full, aspect-fitted original image. */
export function dragCrop(box: CropBox, mode: CropDrag, dx: number, dy: number): CropBox {
  const minimum = 0.04;
  if (mode === 'move') {
    const x = clamp(dx, -box.left, 1 - box.right);
    const y = clamp(dy, -box.top, 1 - box.bottom);
    return { left: box.left + x, right: box.right + x, top: box.top + y, bottom: box.bottom + y };
  }
  return {
    left: mode.endsWith('left') ? clamp(box.left + dx, 0, box.right - minimum) : box.left,
    right: mode.endsWith('right') ? clamp(box.right + dx, box.left + minimum, 1) : box.right,
    top: mode.startsWith('top') ? clamp(box.top + dy, 0, box.bottom - minimum) : box.top,
    bottom: mode.startsWith('bottom') ? clamp(box.bottom + dy, box.top + minimum, 1) : box.bottom,
  };
}

export const captureGuide: CropBox = { left: 0.08, top: 0.27, right: 0.92, bottom: 0.63 };
type Size = { width: number; height: number };
export function fittedCameraFrame(stage: Size): Size {
  const width = Math.max(0, Math.min(stage.width, stage.height * 3 / 4));
  return { width, height: width * 4 / 3 };
}

/** Only used with the explicit 4:3 stream and a matching, aspect-fitted viewport. */
export function seedGuideCrop(photo: Size, viewport: Size): CropBox | null {
  if (![photo.width, photo.height, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) return null;
  if (Math.abs(photo.width / photo.height - viewport.width / viewport.height) > 0.005) return null;
  const padding = Math.min(viewport.width, viewport.height) * 0.03;
  return {
    left: clamp(captureGuide.left - padding / viewport.width, 0, 1),
    top: clamp(captureGuide.top - padding / viewport.height, 0, 1),
    right: clamp(captureGuide.right + padding / viewport.width, 0, 1),
    bottom: clamp(captureGuide.bottom + padding / viewport.height, 0, 1),
  };
}
export function cropToPixels(box: CropBox, photo: Size) {
  if (![photo.width, photo.height].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('The original photo size is unavailable.');
  const originX = clamp(Math.round(box.left * photo.width), 0, photo.width - 1);
  const originY = clamp(Math.round(box.top * photo.height), 0, photo.height - 1);
  return { originX, originY, width: Math.max(1, Math.min(photo.width, Math.round(box.right * photo.width)) - originX), height: Math.max(1, Math.min(photo.height, Math.round(box.bottom * photo.height)) - originY) };
}
