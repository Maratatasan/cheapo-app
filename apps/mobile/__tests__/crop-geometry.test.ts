import { cropToPixels, dragCrop, fullPhoto, seedGuideCrop } from '../data/crop-geometry';
it('resizes both corners in full-original coordinates', () => {
  const first = dragCrop(fullPhoto, 'top-left', 0.25, 0.25);
  expect(dragCrop(first, 'bottom-right', -0.25, -0.25)).toEqual({ left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 });
});
it('clamps every corner before it crosses the opposite corner or leaves the image', () => {
  expect(dragCrop(fullPhoto, 'top-left', 2, 2)).toEqual({ left: 0.96, top: 0.96, right: 1, bottom: 1 });
  expect(dragCrop(fullPhoto, 'bottom-right', -2, -2)).toEqual({ left: 0, top: 0, right: 0.04, bottom: 0.04 });
  expect(dragCrop(fullPhoto, 'top-right', 2, -2)).toEqual(fullPhoto);
  expect(dragCrop(fullPhoto, 'bottom-left', -2, 2)).toEqual(fullPhoto);
});
it('moves a box without resizing and stops at the image edges', () => {
  const box = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 };
  expect(dragCrop(box, 'move', 2, -2)).toEqual({ left: 0.5, top: 0, right: 1, bottom: 0.5 });
});

it('seeds the matched-aspect guide with a small surrounding margin in original pixels', () => {
  const box = seedGuideCrop({ width: 3000, height: 4000 }, { width: 300, height: 400 });
  expect(box).not.toBeNull();
  expect(cropToPixels(box!, { width: 3000, height: 4000 })).toEqual({ originX: 150, originY: 990, width: 2700, height: 1620 });
});
it('does not guess guide coordinates when the photo and preview aspects differ', () => {
  expect(seedGuideCrop({ width: 4000, height: 3000 }, { width: 300, height: 400 })).toBeNull();
  expect(seedGuideCrop({ width: 3000, height: 4000 }, { width: 0, height: 0 })).toBeNull();
});
