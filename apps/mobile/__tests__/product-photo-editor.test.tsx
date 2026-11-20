import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProductPhotoEditor } from '../component/product-photo-editor';
import type { PreparedProductPhoto } from '../data/product-presentation-photos';

const productId = 'exact-product';
const currentUri = 'file:///previous-product-photo.jpg';
const replacementUri = 'file:///chosen-product-photo.jpg';
const candidate = { uri: replacementUri, width: 100, height: 80, mimeType: 'image/jpeg' } as const;
const fixturePhoto = (uri: string, version = 1) => ({ ...candidate, uri, version, sha256: 'a'.repeat(64), byteCount: 12,
  lastSyncedAt: '2026-01-02T10:00:00.000Z' });

function fixture() {
  const plan: PreparedProductPhoto = { productId, operationId: 'exact-operation', expectedVersion: 1,
    sha256: 'a'.repeat(64), byteCount: 12, width: candidate.width, height: candidate.height };
  const photos = {
    read: jest.fn().mockResolvedValue({ status: 'fresh', photo: fixturePhoto(currentUri) }),
    prepare: jest.fn().mockResolvedValue(plan), replace: jest.fn().mockResolvedValue({ status: 'available', version: 2 }),
  };
  const choose = jest.fn().mockResolvedValue(candidate);
  return { photos, choose, plan };
}

async function selectFromPhone() {
  await fireEvent.press(await screen.findByRole('button', { name: 'Change product photo', disabled: false }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose from phone' }));
  await screen.findByLabelText('New product photo preview');
}

test('cancelling a chosen photo preserves the saved photo and does not prepare or publish', async () => {
  const { photos, choose } = fixture();
  await render(<ProductPhotoEditor productId={productId} photos={photos} choose={choose} />);
  await selectFromPhone();
  expect(choose).toHaveBeenCalledWith('library');
  expect(screen.getByLabelText('Current product photo')).toHaveProp('source', { uri: currentUri });
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel photo change' }));
  expect(screen.queryByLabelText('New product photo preview')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Current product photo')).toHaveProp('source', { uri: currentUri });
  expect(photos.prepare).not.toHaveBeenCalled();
  expect(photos.replace).not.toHaveBeenCalled();
});

test('camera permission denial keeps the current photo and offers the library', async () => {
  const { photos, choose } = fixture();
  choose.mockResolvedValueOnce('camera-denied');
  await render(<ProductPhotoEditor productId={productId} photos={photos} choose={choose} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Change product photo', disabled: false }));
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Allow camera access/);
  expect(screen.getByRole('button', { name: 'Choose from phone' })).toBeEnabled();
  expect(screen.getByLabelText('Current product photo')).toHaveProp('source', { uri: currentUri });
  expect(photos.replace).not.toHaveBeenCalled();
});

test('an interrupted save retains the original image and operation until explicit retry', async () => {
  const { photos, choose, plan } = fixture();
  photos.replace.mockResolvedValueOnce({ status: 'retry' });
  await render(<ProductPhotoEditor productId={productId} photos={photos} choose={choose} />);
  await selectFromPhone();
  expect(photos.replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save product photo' }));
  expect(await screen.findByRole('alert')).toBeOnTheScreen();
  expect(screen.getByLabelText('Current product photo')).toHaveProp('source', { uri: currentUri });
  await fireEvent.press(screen.getByRole('button', { name: 'Save product photo' }));
  expect(await screen.findByText('Product photo saved.')).toBeOnTheScreen();
  expect(photos.prepare).toHaveBeenCalledTimes(1);
  expect(photos.replace).toHaveBeenNthCalledWith(1, plan, expect.any(AbortSignal));
  expect(photos.replace).toHaveBeenNthCalledWith(2, plan, expect.any(AbortSignal));
  expect(screen.getByLabelText('Current product photo')).toHaveProp('source', { uri: replacementUri });
});

test('a newer version stays visible and requires another confirmation before replacement', async () => {
  const { photos, choose, plan } = fixture();
  const nextPlan = { ...plan, expectedVersion: 2, operationId: 'confirmed-after-conflict' };
  photos.prepare.mockResolvedValueOnce(plan).mockResolvedValueOnce(nextPlan);
  photos.replace.mockResolvedValueOnce({ status: 'conflict', currentVersion: 2 }).mockResolvedValueOnce({ status: 'available', version: 3 });
  await render(<ProductPhotoEditor productId={productId} photos={photos} choose={choose} />);
  await selectFromPhone();
  const winningUri = 'file:///newer-shared-photo.jpg';
  photos.read.mockResolvedValue({ status: 'fresh', photo: fixturePhoto(winningUri, 2) });
  await fireEvent.press(screen.getByRole('button', { name: 'Save product photo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/The shared photo changed/);
  expect(screen.getByLabelText('Current product photo')).toHaveProp('source', { uri: winningUri });
  expect(screen.getByLabelText('New product photo preview')).toHaveProp('source', { uri: replacementUri });
  expect(photos.replace).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Save product photo' }));
  expect(photos.prepare).toHaveBeenLastCalledWith(productId, 2, candidate, expect.any(AbortSignal));
  expect(photos.replace).toHaveBeenLastCalledWith(nextPlan, expect.any(AbortSignal));
});
