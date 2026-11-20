import { scanFromURLAsync, type BarcodeScanningResult } from 'expo-camera';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { decodePhotoBarcodes } from '@/data/photo-barcode';

jest.mock('expo-camera', () => ({ scanFromURLAsync: jest.fn() }));
jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const original = 'file:///photos/original.jpg';
const scan = jest.mocked(scanFromURLAsync);
const native = jest.mocked(requireOptionalNativeModule);

beforeEach(() => {
  scan.mockReset();
  native.mockReset().mockReturnValue(null);
});

function detected(data: string, raw?: string): BarcodeScanningResult {
  return {
    data,
    raw,
    type: 'ean13',
    cornerPoints: [],
    bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
  };
}

test('reads the original photo and preserves the encoded leading zero', async () => {
  scan.mockImplementation(async uri => uri === original ? [detected('36000291452', '0036000291452')] : []);

  await expect(decodePhotoBarcodes(original)).resolves.toEqual({
    status: 'found',
    codes: ['0036000291452'],
  });
});

test('returns every distinct valid GTIN and keeps equivalent UPC-A and EAN-13 together', async () => {
  scan.mockResolvedValue([
    detected('036000291452'),
    detected('0036000291452'),
    detected('4006381333931'),
    detected('96385074'),
    detected('4006381333932'),
  ]);

  await expect(decodePhotoBarcodes(original)).resolves.toEqual({
    status: 'found',
    codes: ['036000291452', '4006381333931', '96385074'],
  });
});

test.each([
  { scenario: 'no barcode', detections: [] },
  { scenario: 'invalid barcodes', detections: [detected('4006381333932'), detected('00000000'), detected('SKU-1234')] },
])('offers no candidate from $scenario', async ({ detections }) => {
  scan.mockResolvedValue(detections);
  await expect(decodePhotoBarcodes(original)).resolves.toEqual({ status: 'empty' });
});

test('returns a recoverable outcome when the native decoder fails', async () => {
  scan.mockRejectedValue(new Error('Image could not be loaded'));

  await expect(decodePhotoBarcodes(original)).resolves.toEqual({ status: 'error' });
});

test.each(['ios', 'web'] as const)('uses manual fallback on %s when no retail module is available', async os => {
  const platform = jest.replaceProperty(Platform, 'OS', os);
  try {
    await expect(decodePhotoBarcodes(original)).resolves.toEqual({ status: 'unavailable' });
    expect(scan).not.toHaveBeenCalled();
  } finally {
    platform.restore();
  }
});

test('reads multiple iPhone retail codes locally and runs the shared GTIN validation', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'ios');
  try {
    const readRetailBarcodes = jest.fn().mockResolvedValue(['0036000291452', '036000291452', '96385074', '4006381333932']);
    native.mockReturnValue({ readRetailBarcodes });
    await expect(decodePhotoBarcodes(original)).resolves.toEqual({ status: 'found', codes: ['0036000291452', '96385074'] });
    expect(readRetailBarcodes).toHaveBeenCalledWith(original);
    expect(scan).not.toHaveBeenCalled();
    await expect(decodePhotoBarcodes('https://example.test/original.jpg')).resolves.toEqual({ status: 'unavailable' });
    expect(readRetailBarcodes).toHaveBeenCalledTimes(1);
    native.mockReturnValue({ read: jest.fn() });
    await expect(decodePhotoBarcodes(original)).resolves.toEqual({ status: 'unavailable' });
  } finally {
    platform.restore();
  }
});

test('does not retrieve a remote photo', async () => {
  await expect(decodePhotoBarcodes('https://example.test/original.jpg')).resolves.toEqual({
    status: 'unavailable',
  });
  expect(scan).not.toHaveBeenCalled();
});
