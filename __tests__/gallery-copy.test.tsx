import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { GalleryCopy } from '../component/gallery-copy';
const mockCopy = jest.fn();
jest.mock('../lib/photo-gallery', () => ({ saveGalleryCopy: (...args: unknown[]) => mockCopy(...args) }));
const photo = { uri: 'file:///documents/selected.jpg', width: 500, height: 300, mimeType: 'image/jpeg' as const };
beforeEach(() => { mockCopy.mockReset(); });
afterEach(() => { jest.restoreAllMocks(); });
it('copies only after explicit press and reports success only after completion', async () => {
  mockCopy.mockResolvedValue('content://media/123');
  await render(<GalleryCopy photo={photo} />);
  expect(mockCopy).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save copy to phone gallery' }));
  expect(mockCopy).toHaveBeenCalledWith(photo);
  expect(await screen.findByRole('button', { name: 'Gallery copy saved' })).toBeDisabled();
});
it('keeps the copy action available after failure without claiming success', async () => {
  mockCopy.mockRejectedValue(Error('Storage full'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<GalleryCopy photo={photo} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Save copy to phone gallery' }));
  expect(alert).toHaveBeenCalledWith('Gallery copy not saved', expect.stringContaining('Storage full'));
  expect(screen.queryByText('Gallery copy saved')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save copy to phone gallery' })).toBeEnabled();
});
