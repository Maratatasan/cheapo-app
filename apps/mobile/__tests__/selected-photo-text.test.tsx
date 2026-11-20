import { act, renderHook } from '@testing-library/react-native';
import type { PhotoAsset } from '@/data/local-photo';
import { readPhotoText, type PhotoTextResult, type SelectedPhotoText } from '@/data/photo-text';
import { useSelectedPhotoText } from '@/component/use-selected-photo-text';

jest.mock('@/data/photo-text', () => ({ readPhotoText: jest.fn() }));

const read = jest.mocked(readPhotoText);
const photo = (name: string): PhotoAsset => ({ uri: `file:///${name}.jpg`, width: 200, height: 400, mimeType: 'image/jpeg' });

test('waits for the original native read and skips superseded crops after rapid retakes', async () => {
  let finishOriginal!: (result: PhotoTextResult) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finishOriginal = resolve; }));
  read.mockResolvedValueOnce({ status: 'empty' });
  const original = photo('original');
  const crop = photo('crop');
  const replacement = photo('replacement');
  const { result, rerender } = await renderHook<SelectedPhotoText | undefined, { selected: PhotoAsset }>(
    ({ selected }) => useSelectedPhotoText(selected), { initialProps: { selected: original } },
  );
  expect(read.mock.calls).toEqual([[original.uri]]);

  await rerender({ selected: crop });
  await rerender({ selected: replacement });
  expect(read.mock.calls).toEqual([[original.uri]]);
  expect(result.current).toBeUndefined();

  await act(() => finishOriginal({ status: 'error' }));
  expect(read.mock.calls).toEqual([[original.uri], [replacement.uri]]);
  expect(result.current).toEqual({ photo: replacement, result: { status: 'empty' } });
});
