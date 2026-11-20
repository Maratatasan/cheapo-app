import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { readPhotoText, type PhotoTextEvidence } from '../data/photo-text';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

const loadModule = jest.mocked(requireOptionalNativeModule);
const read = jest.fn<Promise<PhotoTextEvidence>, [string]>();
const uri = 'file:///local/label.jpg';
const evidence: PhotoTextEvidence = {
  width: 1200,
  height: 1600,
  blocks: [{ lines: [{ text: '£2.50', box: [0.4, 0.25, 0.7, 0.35],
    elements: [{ text: '£2.50', box: [0.4, 0.25, 0.7, 0.35] }] }] }],
};

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  loadModule.mockReturnValue({ read });
  read.mockReset().mockResolvedValue(evidence);
});

afterEach(() => {
  jest.restoreAllMocks();
  loadModule.mockReset();
});

test('reads the requested local image with its oriented dimensions and text geometry', async () => {
  await expect(readPhotoText(uri)).resolves.toEqual({ status: 'found', evidence });
  expect(loadModule).toHaveBeenCalledWith('CheapoPhotoText');
  expect(read).toHaveBeenCalledWith(uri);
  const crop = 'content://photos.example/crop';
  await expect(readPhotoText(crop)).resolves.toEqual({ status: 'found', evidence });
  expect(read).toHaveBeenLastCalledWith(crop);
});

test('distinguishes an empty result, native failure and missing module', async () => {
  read.mockResolvedValueOnce({ ...evidence, blocks: [] }).mockRejectedValueOnce(new Error('unreadable'));
  await expect(readPhotoText(uri)).resolves.toEqual({ status: 'empty' });
  await expect(readPhotoText(uri)).resolves.toEqual({ status: 'error' });
  loadModule.mockReturnValue(null);
  await expect(readPhotoText(uri)).resolves.toEqual({ status: 'unavailable' });
});

test.each(['https://example.test/image.jpg', 'file://remote.example/photo.jpg', 'data:image/jpeg,imagedata'])(
  'leaves unsupported image locations to the regular review flow', async unsupportedUri => {
    await expect(readPhotoText(unsupportedUri)).resolves.toEqual({ status: 'unavailable' });
    expect(loadModule).not.toHaveBeenCalled();
  },
);

test.each(['ios', 'web'] as const)('reports unavailable on %s without loading Android code', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  await expect(readPhotoText(uri)).resolves.toEqual({ status: 'unavailable' });
  expect(loadModule).not.toHaveBeenCalled();
});

test('abandons a retaken photo before its old recognition can finish', async () => {
  const old = new AbortController();
  let finishOld: ((value: PhotoTextEvidence) => void) | undefined;
  read.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
  const stale = readPhotoText(uri, old.signal);
  old.abort();
  await expect(stale).resolves.toEqual({ status: 'aborted' });
  const replacement = 'file:///local/retake.jpg';
  await expect(readPhotoText(replacement)).resolves.toEqual({ status: 'found', evidence });
  finishOld?.(evidence);
  await expect(stale).resolves.toEqual({ status: 'aborted' });
  await expect(readPhotoText(uri, old.signal)).resolves.toEqual({ status: 'aborted' });
  expect(read.mock.calls).toEqual([[uri], [replacement]]);
});
