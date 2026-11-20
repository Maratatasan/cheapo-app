import { launchImageLibraryAsync } from 'expo-image-picker';
import { choosePhoto } from '@/lib/choose-photo';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({}));

test('keeps only normalized original date metadata from the picker', async () => {
  const jpeg = { uri: 'file:///sample.jpg', width: 800, height: 600, mimeType: 'image/jpeg' };
  jest.mocked(launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ ...jpeg, exif: {
    DateTimeOriginal: '2020:11:18 15:03:23', OffsetTimeOriginal: '+00:00', SubsecTimeOriginal: '911', GPSLatitude: 12,
  } }] });
  await expect(choosePhoto()).resolves.toEqual({ ...jpeg, takenOn: '2020-11-18', takenAt: '2020-11-18T15:03:23.911Z' });
  expect(launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ exif: true }));
});
