import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PhotoCrop } from '../component/photo-crop';
jest.mock('../data/local-photo', () => ({ localPhotoSource: async (photo: unknown) => photo }));
const mockCrop = jest.fn();
const mockSave = jest.fn();
const mockRender = jest.fn();
const mockRelease = jest.fn();
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: () => ({ crop: mockCrop, renderAsync: mockRender, release: mockRelease }) }, SaveFormat: { JPEG: 'jpeg' } }));
const original = { uri: 'file:///original.jpg', width: 1000, height: 500, mimeType: 'image/jpeg' as const };
beforeEach(() => { jest.clearAllMocks(); mockSave.mockResolvedValue({ uri: 'file:///cropped.jpg', width: 500, height: 250 }); mockRender.mockResolvedValue({ saveAsync: mockSave, release: mockRelease }); });
it('fits the full original, adjusts a corner, and returns the generated JPEG metadata', async () => {
  const apply = jest.fn();
  await render(<PhotoCrop original={original} onApply={apply} onCancel={jest.fn()} />);
  // Lay out the fit container; selection coordinates are relative to the fitted image.
  await fireEvent(screen.getByTestId('crop-stage'), 'layout', { nativeEvent: { layout: { width: 400, height: 400 } } });
  expect(screen.getByLabelText('Full original photo')).toHaveProp('resizeMode', 'contain');
  // Accessible adjustment uses the same geometry as pointer dragging.
  await fireEvent(screen.getByLabelText('top-left crop handle'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
  await fireEvent.press(screen.getByText('Use crop'));
  expect(mockCrop).toHaveBeenCalledWith({ originX: 20, originY: 10, width: 980, height: 490 });
  expect(apply).toHaveBeenCalledWith({ uri: 'file:///cropped.jpg', width: 500, height: 250, mimeType: 'image/jpeg' }, expect.objectContaining({ left: 0.02, top: 0.02 }));
});
it('keeps the original and allows cancel when native crop fails', async () => {
  mockRender.mockRejectedValue(Error('Native failure'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const cancel = jest.fn(); const apply = jest.fn();
  await render(<PhotoCrop original={original} onApply={apply} onCancel={cancel} />);
  await fireEvent.press(screen.getByText('Use crop'));
  expect(alert).toHaveBeenCalledWith('Unable to crop photo', expect.any(String));
  expect(apply).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('Cancel'));
  expect(cancel).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

it('uses a supplied guide selection in original pixels and Reset restores the full original', async () => {
  const apply = jest.fn();
  await render(<PhotoCrop original={original} initialBox={{ left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 }} onApply={apply} onCancel={jest.fn()} />);
  await fireEvent.press(screen.getByText('Use crop'));
  expect(mockCrop).toHaveBeenCalledWith({ originX: 100, originY: 100, width: 800, height: 300 });
  await fireEvent.press(screen.getByText('Reset'));
  await fireEvent.press(screen.getByText('Use crop'));
  expect(mockCrop).toHaveBeenLastCalledWith({ originX: 0, originY: 0, width: 1000, height: 500 });
});
