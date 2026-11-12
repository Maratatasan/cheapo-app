import { Platform } from 'react-native';
import { saveGalleryCopy } from '../lib/photo-gallery';
const mockCreate = jest.fn();
const mockPermission = jest.fn();
jest.mock('expo-media-library', () => ({ Asset: { create: (...args: unknown[]) => mockCreate(...args) }, requestPermissionsAsync: (...args: unknown[]) => mockPermission(...args) }));
const photo = { uri: 'file:///documents/selected.jpg', width: 500, height: 300, mimeType: 'image/jpeg' as const };
beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { jest.restoreAllMocks(); });
it('writes only the selected local JPEG on modern Android without requesting broad photo access', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(36);
  mockCreate.mockResolvedValue({ id: 'content://media/external/images/media/123' });
  expect(await saveGalleryCopy(photo)).toBe('content://media/external/images/media/123');
  expect(mockCreate).toHaveBeenCalledWith(photo.uri);
  expect(mockPermission).not.toHaveBeenCalled();
});
it('requests only add permission on iOS and never writes when permission is denied', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockPermission.mockResolvedValue({ granted: false });
  await expect(saveGalleryCopy(photo)).rejects.toThrow('gallery permission');
  expect(mockPermission).toHaveBeenCalledWith(true, []);
  expect(mockCreate).not.toHaveBeenCalled();
});
it('reports a failed gallery write and leaves the private local photo untouched', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(36);
  mockCreate.mockRejectedValue(Error('Gallery storage full'));
  await expect(saveGalleryCopy(photo)).rejects.toThrow('Gallery storage full');
  expect(photo.uri).toBe('file:///documents/selected.jpg');
});
