/// <reference types="jest" />

import React from "react";
import { Alert, Image, Platform, ScrollView } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
} from "@testing-library/react-native";
import { CameraComponent } from "../component/camera";

const mockSaveLocalPhoto = jest.fn();
const mockLoadLocalPhotos = jest.fn();
const mockUseCheapoShopping = jest.fn();
jest.mock('../component/cheapo-shopping-provider', () => ({ useCheapoShopping: () => mockUseCheapoShopping() }));
const mockCatalog = jest.fn();
jest.mock('../hooks/use-enrolled-catalog', () => ({ useEnrolledCatalog: () => mockCatalog() }));
const mockSharedReads = jest.fn();
jest.mock('../data/cheapo-shopping-read-device', () => ({ openCheapoSavedPriceReads: (...args: unknown[]) => mockSharedReads(...args) }));
const mockAddLocalProduct = jest.fn();
const mockFindLocalProduct = jest.fn();
const mockScanFromURLAsync = jest.fn();
const mockReadPhotoText = jest.fn();
jest.mock('../data/photo-text', () => ({ readPhotoText: (...args: unknown[]) => mockReadPhotoText(...args) }));
jest.mock('../data/local-products', () => ({
  addLocalProduct: (...args: unknown[]) => mockAddLocalProduct(...args),
  findLocalProductByBarcode: (...args: unknown[]) => mockFindLocalProduct(...args),
}));
const mockChoosePhoto = jest.fn();
let mockFieldPhotoAnalysisEnabled = false;
const mockRequestPhotoDraft = jest.fn();
const mockRequestProductIdentityDraft = jest.fn();
jest.mock('../lib/direct-auth/photo-analysis', () => ({
  requestPhotoDraft: (...args: unknown[]) => mockRequestPhotoDraft(...args),
  requestProductIdentityDraft: (...args: unknown[]) => mockRequestProductIdentityDraft(...args),
}));
jest.mock('../lib/direct-auth/phone-session', () => ({
  get fieldPhotoAnalysisEnabled() { return mockFieldPhotoAnalysisEnabled; },
  phoneAuth: {
    getState: () => ({ planAllowed: true, busy: false }),
    subscribe: jest.fn(),
    restore: jest.fn(),
    withPlanAccess: (action: (token: string) => unknown) => action('test-token'),
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    exists = true;
    size = 3;
    async base64() { return '/9j/'; }
  },
}));
jest.mock('../lib/choose-photo', () => ({ choosePhoto: () => mockChoosePhoto() }));
jest.mock('../data/local-photo', () => ({ emptyReview: (shop = '') => ({ productName: '', price: '', currency: 'GBP', shop, unitPrice: '', unit: '' }), reviewComplete: (review: any) => !!review?.productName && !!review?.price && !!review?.shop, saveLocalPhoto: (...args: unknown[]) => mockSaveLocalPhoto(...args), loadLocalPhotos: () => mockLoadLocalPhotos() }));
jest.mock('../component/photo-crop', () => ({ PhotoCrop: ({ onApply, onCancel }: any) => {
  const React = require('react'); const { Button, View } = require('react-native');
  return React.createElement(View, null, React.createElement(Button, { title: 'Apply crop', onPress: () => onApply({ uri: 'file:///cropped.jpg', width: 200, height: 100, mimeType: 'image/jpeg' }, { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 }) }), React.createElement(Button, { title: 'Cancel crop', onPress: onCancel }));
} }));
const mockRequestPermission = jest.fn();
const mockTakePictureAsync = jest.fn();
let mockPermission: { granted: boolean; canAskAgain?: boolean } | null = null;

jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");

  return {
    CameraView: React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: (...args: unknown[]) => mockTakePictureAsync(...args),
      }));

      return React.createElement(View, {
        testID: "camera-preview",
        onCameraReady: props.onCameraReady,
        onBarcodeScanned: props.onBarcodeScanned,
      });
    }),
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
    scanFromURLAsync: (...args: unknown[]) => mockScanFromURLAsync(...args),
  };
});

describe("CameraComponent", () => {
  beforeEach(() => {
    jest.spyOn(Image, "getSize").mockImplementation((uri, success) => { success?.(1200, 800); return Promise.resolve({ width: 1200, height: 800 }); });
    mockPermission = null;
    mockFieldPhotoAnalysisEnabled = false;
    mockRequestPhotoDraft.mockReset();
    mockRequestProductIdentityDraft.mockReset();
    mockSaveLocalPhoto.mockReset();
    mockAddLocalProduct.mockReset();
    mockFindLocalProduct.mockReset().mockResolvedValue(undefined);
    mockScanFromURLAsync.mockReset().mockResolvedValue([]);
    mockReadPhotoText.mockReset().mockResolvedValue({ status: 'unavailable' });
    mockChoosePhoto.mockReset();
    mockLoadLocalPhotos.mockResolvedValue([]);
    mockUseCheapoShopping.mockReset().mockReturnValue(null);
    mockCatalog.mockReset().mockReturnValue(null);
    mockSharedReads.mockReset();
    mockRequestPermission.mockReset();
    mockTakePictureAsync.mockReset();
    delete process.env.EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("asks for camera permission when access has not been granted", async () => {
    mockPermission = { granted: false };
    await render(<CameraComponent />);

    await fireEvent.press(screen.getByRole("button", { name: "Grant Permission" }));

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it("chooses and crops a phone photo without camera permission", async () => {
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: "file:///chosen.jpg", width: 1200, height: 800, mimeType: "image/jpeg" });
    await render(<CameraComponent currentShop={{ id: "test-shop", displayName: "Test shop" }} />);

    await fireEvent.press(screen.getByRole("button", { name: "Choose photo" }));
    const applyCrop = await screen.findByText("Apply crop");
    expect(screen.queryByLabelText("Price photo preview")).not.toBeOnTheScreen();
    await fireEvent.press(applyCrop);
    expect(screen.getByLabelText("Confirmed shop: Test shop")).toHaveTextContent("Test shop");
    expect(screen.getByLabelText("Price photo preview")).toHaveProp("source", { uri: "file:///cropped.jpg" });
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it.each([true, false])('commits a reviewed photo before showing its enrolled save status (confirmed shop: %s)', async linked => {
    const shop = { id: 'saved-shop', displayName: 'Saved shop' };
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///selected.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    let committed = false;
    const saveNewPhoto = jest.fn(async record => {
      committed = true;
      return { record, pending: linked ? 'waiting' : 'needs-shop' };
    });
    const retry = jest.fn(async () => { expect(committed).toBe(true); });
    const readPriceSaveStatus = jest.fn().mockResolvedValue(linked ? 'waiting' : 'needs-shop');
    const subscribeSync = jest.fn().mockReturnValue(() => {});
    mockUseCheapoShopping.mockReturnValue({ priceRecords: { load: async () => null, loadPhotos: async () => [], saveNewPhoto }, retry,
      assertOwner: async () => {}, readPriceSaveStatus, subscribeSync });
    await render(<CameraComponent currentShop={linked ? shop : undefined} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByText('Apply crop'));
    await fireEvent.changeText(screen.getByLabelText('Product name'), 'Brown rice');
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '1.95');
    if (!linked) await fireEvent.changeText(screen.getByLabelText('Confirmed shop'), 'Known by name only');
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
    expect(saveNewPhoto).toHaveBeenCalledWith(expect.objectContaining({ shop: linked ? shop : undefined,
      review: expect.objectContaining({ productName: 'Brown rice', price: '1.95' }),
      original: expect.objectContaining({ uri: 'file:///selected.jpg' }), selected: expect.objectContaining({ uri: 'file:///cropped.jpg' }) }));
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(linked ? 1 : 0);
    expect(screen.getByText(linked ? 'Saved on this phone · Waiting to sync' : 'Saved on this phone · Needs shop')).toBeOnTheScreen();
    if (linked) {
      readPriceSaveStatus.mockResolvedValue('photo-pending');
      await act(() => subscribeSync.mock.calls[0][0]());
      expect(screen.getByText('Price synced · Photo pending')).toBeOnTheScreen();
      readPriceSaveStatus.mockResolvedValue('synced');
      await act(() => subscribeSync.mock.calls[0][0]());
      expect(screen.getByText('Synced to Cheapo')).toBeOnTheScreen();
      expect(screen.queryByText('Saved on this phone · Waiting to sync')).toBeNull();
    }
  });

  it('reopens an exact owned imported photo and queues reviewed price and crop selection as one correction', async () => {
    mockPermission = { granted: false };
    const id = 'imported-rice';
    const cloudId = 'd002d3a7-2744-4414-8336-afc644ec6878';
    const owner = { origin: 'https://shopping.example', householdId: 'household-a', shopperId: 'shopper-a' };
    const original = { uri: 'file:///protected-original.jpg', width: 400, height: 200, mimeType: 'image/jpeg' };
    const review = { productName: 'Saved rice', price: '1.95', currency: 'GBP', shop: 'Test market', unitPrice: '', unit: '' };
    const record = { id, capturedAt: '2026-11-12T12:00:00.000000Z', original, selected: original,
      shop: { id: 'stable-shop', displayName: review.shop }, review };
    const observation = { id: cloudId, sourceId: id, version: 3, ownedByCurrentShopper: true, capturedAt: record.capturedAt,
      productName: 'Checked rice', priceAmount: '2.50', currency: 'GBP', review: null, shopId: record.shop.id,
      shopDisplayName: review.shop, photos: [], cropBox: null, selectedPhotoRole: null };
    const loadPriceHistory = jest.fn().mockResolvedValue({ status: 'fresh', value: { observations: [observation] } });
    mockSharedReads.mockResolvedValue({ loadPriceHistory, assertCurrent: jest.fn(),
      loadPriceObservation: jest.fn().mockResolvedValue({ status: 'fresh', value: { observation } }) });
    const commitMutation = jest.fn().mockResolvedValue(undefined);
    const saveNewPhoto = jest.fn();
    const retry = jest.fn().mockResolvedValue(undefined);
    mockUseCheapoShopping.mockReturnValue({ owner, commitMutation, retry, assertOwner: async () => {},
      priceQueue: { read: async () => ({ entries: [] }) }, loadPriceChanges: async () => [],
      priceRecords: { loadPhotos: async () => [record], saveNewPhoto },
      subscribeSync: () => () => {}, readPriceSaveStatus: async () => 'waiting',
    });
    await render(<CameraComponent />);
    await fireEvent.press(await screen.findByRole('button', { name: /^Review / }));
    expect(await screen.findByLabelText('Product name')).toHaveDisplayValue('Checked rice');
    expect(loadPriceHistory).toHaveBeenCalledWith({ sourceId: id, includeRecordedInError: true }, expect.any(AbortSignal));
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.80');
    await fireEvent.press(screen.getByText('Crop photo'));
    await fireEvent.press(await screen.findByText('Apply crop'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
    expect(commitMutation).toHaveBeenCalledTimes(1);
    expect(commitMutation.mock.calls[0][0].action).toMatchObject({ kind: 'price', priceKey: cloudId,
      base: { kind: 'version', id: cloudId, version: 3 }, change: { action: 'correct', review: { price: '2.80' },
        photoSelection: { role: 'crop', cropBox: { left: .25, top: .25, right: .75, bottom: .75 } } } });
    expect(saveNewPhoto).not.toHaveBeenCalled();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Use original'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
    expect(commitMutation.mock.calls[1][0].action).toMatchObject({ kind: 'price', priceKey: cloudId,
      base: { kind: 'operation', operationId: commitMutation.mock.calls[0][0].operationId },
      change: { photoSelection: { role: 'original' } } });
    expect(screen.getByLabelText('Price photo preview')).toHaveProp('source', { uri: original.uri });
  });

  it.each(['fresh', 'unavailable'])('only first-syncs a completed local photo after a verified empty source lookup (%s)', async status => {
    mockPermission = { granted: false };
    const original = { uri: 'file:///protected-local.jpg', width: 400, height: 200, mimeType: 'image/jpeg' };
    const review = { productName: 'Local oats', price: '1.95', currency: 'GBP', shop: 'Test market', unitPrice: '', unit: '' };
    const record = { id: 'completed-local', capturedAt: '2026-11-12T12:00:00.000000Z', original, selected: original,
      shop: { id: 'stable-shop', displayName: review.shop }, review };
    mockSharedReads.mockResolvedValue({ assertCurrent: jest.fn(), loadPriceHistory: jest.fn().mockResolvedValue({
      status, ...(status === 'fresh' ? { value: { observations: [] } } : {}),
    }) });
    const saveNewPhoto = jest.fn().mockImplementation(async draft => ({ record: draft, pending: 'waiting' }));
    const commitMutation = jest.fn();
    mockUseCheapoShopping.mockReturnValue({ commitMutation, retry: jest.fn().mockResolvedValue(undefined), assertOwner: async () => {},
      priceQueue: { read: async () => ({ entries: [] }) }, loadPriceChanges: async () => [],
      priceRecords: { loadPhotos: async () => [record], saveNewPhoto },
      subscribeSync: () => () => {}, readPriceSaveStatus: async () => 'waiting',
    });
    await render(<CameraComponent />);
    await fireEvent.press(await screen.findByRole('button', { name: /^Review / }));
    await fireEvent.changeText(await screen.findByLabelText('Pack price'), '2.20');
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
    if (status === 'fresh') {
      expect(saveNewPhoto).toHaveBeenCalledWith(expect.objectContaining({ id: record.id, original,
        review: expect.objectContaining({ price: '2.20' }) }));
    } else {
      expect(await screen.findByRole('alert')).toHaveTextContent('Cheapo could not match this saved price. Connect and open it again to save your changes.');
      expect(saveNewPhoto).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.20');
    }
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    expect(commitMutation).not.toHaveBeenCalled();
  });

  it('finds a product from the original packaging photo without a price and keeps the photo ready after comparison', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///package.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockScanFromURLAsync.mockResolvedValue([{ data: '036000291452' }]);
    const product = { id: 'exact-rice', name: 'Saved rice', barcode: '00036000291452' };
    mockFindLocalProduct.mockResolvedValue(product);
    const onCompare = jest.fn();
    await render(<CameraComponent productLookup={{ onCompare }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));

    expect(await screen.findByLabelText('Product photo')).toHaveProp('source', { uri: 'file:///package.jpg' });
    expect(await screen.findByText('Saved rice')).toBeOnTheScreen();
    expect(onCompare).toHaveBeenCalledWith(product.barcode, product, expect.objectContaining({
      original: expect.objectContaining({ uri: 'file:///package.jpg' }),
    }));
    expect(mockScanFromURLAsync).toHaveBeenCalledWith('file:///package.jpg', expect.any(Array));
    expect(mockRequestPhotoDraft).not.toHaveBeenCalled();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Pack price')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Compare saved prices' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Retake photo' }));
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeOnTheScreen();
  });

  it('applies a deliberately chosen packaging suggestion before a separate catalog check and product choice', async () => {
    mockPermission = { granted: false };
    mockFieldPhotoAnalysisEnabled = true;
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///package.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockRequestProductIdentityDraft.mockResolvedValue({ product: 'Oat cereal', brand: null, variety: null,
      productType: null, packSize: '500 g', uncertainty: '', alternatives: { product: ['Rolled oats'] } });
    const candidate = { kind: 'catalog', product: { id: 'oats', name: 'Market rolled oats', comparableGroupId: 'oats-group' } } as const;
    const findCandidates = jest.fn(async () => ({ candidates: [candidate], truncated: false }));
    const onCompare = jest.fn();
    await render(<CameraComponent productLookup={{ onCompare: jest.fn(), candidateLookup: { findCandidates, onCompare } }} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Find by packaging details' }));
    await fireEvent.changeText(screen.getByLabelText('Brand (optional)'), 'Market');
    expect(mockRequestProductIdentityDraft).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Analyse packaging photo' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Product name: Rolled oats' }));
    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('');
    await fireEvent.press(screen.getByRole('button', { name: 'Use suggested details' }));

    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Rolled oats');
    expect(screen.getByLabelText('Brand (optional)')).toHaveDisplayValue('Market');
    expect(findCandidates).not.toHaveBeenCalled();
    expect(mockRequestProductIdentityDraft).toHaveBeenCalledWith({ accessToken: 'test-token',
      image: 'data:image/jpeg;base64,/9j/', signal: expect.any(AbortSignal) });
    expect(mockRequestPhotoDraft).not.toHaveBeenCalled();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Check catalog' }));
    const compare = await screen.findByRole('button', { name: 'Compare Market rolled oats' });
    expect(onCompare).not.toHaveBeenCalled();
    await fireEvent.press(compare);
    expect(onCompare).toHaveBeenCalledWith(candidate, expect.objectContaining({
      original: expect.objectContaining({ uri: expect.stringMatching(/^file:\/\//) }),
    }));
    expect(screen.getByLabelText('Product photo')).toHaveProp('source', { uri: 'file:///package.jpg' });
  });

  it('keeps manual packaging entry usable when optional analysis fails', async () => {
    mockPermission = { granted: false };
    mockFieldPhotoAnalysisEnabled = true;
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///package.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockRequestProductIdentityDraft.mockRejectedValue(Error('Photo analysis temporarily unavailable.'));
    const findCandidates = jest.fn(async () => ({ candidates: [], truncated: false }));
    await render(<CameraComponent productLookup={{ onCompare: jest.fn(), candidateLookup: { findCandidates, onCompare: jest.fn() } }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Find by packaging details' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Analyse packaging photo' }));
    expect(await screen.findByText('Photo analysis temporarily unavailable.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Product name'), 'Oats');
    await fireEvent.press(screen.getByRole('button', { name: 'Check catalog' }));
    expect(await screen.findByText('No matching products found')).toBeOnTheScreen();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
  });

  it('cancels a pending identity request when the shopper replaces the packaging photo', async () => {
    mockPermission = { granted: false };
    mockFieldPhotoAnalysisEnabled = true;
    const photo = { uri: 'file:///first-package.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' };
    mockChoosePhoto.mockResolvedValueOnce(photo).mockResolvedValueOnce({ ...photo, uri: 'file:///second-package.jpg' });
    const old = Promise.withResolvers<{ product: string; uncertainty: string }>();
    mockRequestProductIdentityDraft.mockReturnValue(old.promise);
    const findCandidates = jest.fn(async () => ({ candidates: [], truncated: false }));
    await render(<CameraComponent productLookup={{ onCompare: jest.fn(), candidateLookup: { findCandidates, onCompare: jest.fn() } }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Find by packaging details' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Analyse packaging photo' }));
    await waitFor(() => expect(mockRequestProductIdentityDraft).toHaveBeenCalledTimes(1));
    const { signal } = mockRequestProductIdentityDraft.mock.lastCall?.[0];

    await fireEvent.press(screen.getByRole('button', { name: 'Retake photo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Find by packaging details' }));
    expect(signal.aborted).toBe(true);
    await act(async () => { old.resolve({ product: 'First package', uncertainty: '' }); });
    expect(screen.getByLabelText('Product photo')).toHaveProp('source', { uri: 'file:///second-package.jpg' });
    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('');
    expect(screen.queryByText('First package')).not.toBeOnTheScreen();
  });

  it('keeps the packaging photo and newer code when an older lookup finishes or the service is unavailable', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///package.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockScanFromURLAsync.mockResolvedValue([{ data: '036000291452' }, { data: '4006381333931' }]);
    let completeOlder!: (product: { id: string; name: string }) => void;
    const older = new Promise(resolve => { completeOlder = resolve; });
    mockFindLocalProduct.mockReturnValueOnce(older).mockRejectedValueOnce(Error('Unavailable')).mockResolvedValueOnce(undefined);
    const onCompare = jest.fn();
    await render(<CameraComponent productLookup={{ onCompare }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Barcode 036000291452' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Find product' }));
    expect(screen.getByRole('button', { name: 'Checking barcode…' })).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Product barcode'), '4006381333931');
    await fireEvent.press(screen.getByRole('button', { name: 'Find product' }));
    await act(() => completeOlder({ id: 'older', name: 'Old package' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check this barcode. Try again.');
    expect(screen.getByLabelText('Product photo')).toHaveProp('source', { uri: 'file:///package.jpg' });
    expect(screen.getByLabelText('Product barcode')).toHaveDisplayValue('4006381333931');
    expect(screen.queryByText('No saved product matches this barcode.')).not.toBeOnTheScreen();
    expect(onCompare).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry barcode lookup' }));
    expect(await screen.findByText('No saved product matches this barcode.')).toBeOnTheScreen();
    expect(mockFindLocalProduct).toHaveBeenLastCalledWith('04006381333931');
    expect(onCompare).not.toHaveBeenCalled();
  });

  it('shows a known exact barcode before saving and keeps the crop and price when the shopper uses the product', async () => {
    const shop = { id: 'selected-shop', displayName: 'Selected shop' };
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockFindLocalProduct.mockResolvedValue({ id: 'saved-rice', barcode: '00036000291452', name: 'Saved rice', productType: 'Rice' });
    mockSaveLocalPhoto.mockImplementation(async draft => draft);
    const compare = jest.fn();

    await render(<CameraComponent currentShop={shop} onCompareBarcode={compare} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Apply crop' }));
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.50');
    await fireEvent.changeText(screen.getByLabelText('Product barcode'), '036000291452');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));

    expect(await screen.findByText('Saved rice')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save on this phone' })).toBeDisabled();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Compare saved prices' }));
    expect(compare).toHaveBeenCalledWith('00036000291452');
    await fireEvent.press(screen.getByRole('button', { name: 'Use this product' }));
    expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.50');
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

    expect(mockAddLocalProduct).not.toHaveBeenCalled();
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'saved-rice', selected: expect.objectContaining({ uri: 'file:///cropped.jpg' }),
      review: expect.objectContaining({ productName: 'Saved rice', productType: 'Rice', price: '2.50' }),
    }));
  });

  it('offers a retry after an unavailable check and ignores a stale result when the barcode changes', async () => {
    const shop = { id: 'selected-shop', displayName: 'Selected shop' };
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    let completeLookup!: (result: { id: string; name: string; barcode: string }) => void;
    const firstLookup = new Promise(resolve => { completeLookup = resolve; });
    const findByBarcode = jest.fn().mockReturnValueOnce(firstLookup).mockRejectedValueOnce(Error('Offline'))
      .mockResolvedValueOnce(undefined);
    const save = jest.fn();
    mockCatalog.mockReturnValue({ findByBarcode, save });

    await render(<CameraComponent currentShop={shop} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Apply crop' }));
    await fireEvent.changeText(screen.getByLabelText('Product barcode'), '036000291452');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
    expect(screen.getByRole('button', { name: 'Checking barcode…' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Product barcode'), '4006381333931');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
    await act(() => completeLookup({ id: 'old-rice', name: 'Old barcode match', barcode: '00036000291452' }));

    expect(screen.queryByText('Old barcode match')).not.toBeOnTheScreen();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not check this barcode. Try again.');
    expect(screen.queryByText('No saved product matches this barcode.')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save on this phone' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry barcode lookup' }));
    expect(await screen.findByText('No saved product matches this barcode.')).toBeOnTheScreen();
    expect(findByBarcode).toHaveBeenLastCalledWith('04006381333931', expect.any(AbortSignal));
    expect(save).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains the review when a competing product is found (at publication: %s)', async atPublication => {
    const shop = { id: 'selected-shop', displayName: 'Selected shop' };
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockFindLocalProduct.mockResolvedValueOnce(undefined);
    if (atPublication) {
      mockFindLocalProduct.mockResolvedValueOnce(undefined);
      mockAddLocalProduct.mockRejectedValueOnce(Error('This barcode already has a saved product.'));
    }
    mockFindLocalProduct.mockResolvedValue({
      id: 'winning-product', name: 'Existing rice', productType: 'Rice', barcode: '00036000291452',
    });
    mockSaveLocalPhoto.mockImplementation(async draft => draft);

    await render(<CameraComponent currentShop={shop} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Apply crop' }));
    await fireEvent.changeText(screen.getByLabelText('Product barcode'), '036000291452');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
    expect(await screen.findByText('No saved product matches this barcode.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Product name'), 'Draft rice');
    await fireEvent.changeText(screen.getByLabelText('Product type'), 'Rice');
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.50');
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

    expect(await screen.findByText('Existing rice')).toBeOnTheScreen();
    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Draft rice');
    expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.50');
    expect(mockAddLocalProduct).toHaveBeenCalledTimes(atPublication ? 1 : 0);
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Use this product' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({ productId: 'winning-product',
      selected: expect.objectContaining({ uri: 'file:///cropped.jpg' }) }));
  });

  it('lets the shopper confirm one barcode from the original and saves the photo under the new product ID', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const shop = { id: 'selected-shop', displayName: 'Selected shop' };
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockScanFromURLAsync.mockResolvedValue([{ data: '0036000291452' }, { data: '4006381333931' }]);
    mockAddLocalProduct.mockImplementation(async product => product);
    mockSaveLocalPhoto.mockImplementation(async draft => draft);

    await render(<CameraComponent currentShop={shop} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));

    expect(mockScanFromURLAsync).toHaveBeenCalledWith('file:///original.jpg', expect.any(Array));
    expect(screen.getByLabelText('Product barcode')).toHaveDisplayValue('');
    await fireEvent.press(await screen.findByRole('button', { name: 'Barcode 4006381333931' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save on this phone' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/confirm the barcode/i);
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
    expect(mockAddLocalProduct).not.toHaveBeenCalled();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Product name'), 'Fresh tomatoes');
    await fireEvent.changeText(screen.getByLabelText('Product type'), 'Tomatoes');
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.50');
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

    expect(mockAddLocalProduct).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Fresh tomatoes', productType: 'Tomatoes', barcode: '04006381333931',
    }));
    const [{ id }] = mockAddLocalProduct.mock.calls[0];
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({
      productId: id, shop, selected: expect.objectContaining({ uri: 'file:///cropped.jpg' }),
    }));
  });

  it('uses the live scanner after an empty photo result and keeps the draft unconfirmed', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockPermission = { granted: true };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });

    await render(<CameraComponent />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));
    expect(await screen.findByText('No product barcode found in the photo.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Product name'), 'Coca-Cola Zero Sugar');
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '9.99');

    await fireEvent.press(screen.getByRole('button', { name: 'Scan barcode' }));
    const scanner = screen.getByTestId('camera-preview');
    await fireEvent(scanner, 'barcodeScanned', { data: '5449000152474' });
    expect(scanner).toBeOnTheScreen();
    await act(() => {
      scanner.props.onBarcodeScanned({ data: '5449000152473' });
      scanner.props.onBarcodeScanned({ data: '0036000291452' });
    });

    expect(screen.queryByTestId('camera-preview')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Product barcode')).toHaveDisplayValue('5449000152473');
    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Coca-Cola Zero Sugar');
    expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('9.99');
    expect(screen.queryByText(/barcode confirmed/i)).not.toBeOnTheScreen();
    expect(mockAddLocalProduct).not.toHaveBeenCalled();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'deny', 'cancel while awaiting permission'] as const)('keeps the selected suggestion and confirmed barcode on scanner %s', async outcome => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockPermission = { granted: outcome === 'cancel', canAskAgain: true };
    const denied = { granted: false, canAskAgain: false };
    let resolvePermission!: (result: typeof denied) => void;
    mockRequestPermission.mockReturnValue(outcome === 'cancel while awaiting permission'
      ? new Promise(resolve => { resolvePermission = resolve; }) : Promise.resolve(denied));
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockFieldPhotoAnalysisEnabled = true;
    mockRequestPhotoDraft.mockResolvedValue({
      product: 'Tomatoes', price: 1.49, currency: 'GBP', packSize: null, unit_price: null,
      uncertainty: '', alternatives: { price: [1.79] },
    });

    await render(<CameraComponent />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));
    await fireEvent.press(screen.getByRole('button', { name: /analyse photo/i }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Total price: £1.79' }));
    await fireEvent.changeText(screen.getByLabelText('Product barcode'), '0036000291452');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Scan barcode' }));
    if (outcome !== 'cancel') await fireEvent.press(screen.getByRole('button', { name: 'Grant Permission' }));
    if (outcome !== 'deny') await fireEvent.press(screen.getByRole('button', { name: 'Cancel scan' }));
    if (outcome === 'cancel while awaiting permission') await act(() => resolvePermission(denied));

    expect(screen.queryByRole('button', { name: 'Cancel scan' })).not.toBeOnTheScreen();
    expect(screen.getByText('Barcode confirmed · 0036000291452')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Total price: £1.79' })).toBeChecked();
    if (outcome === 'deny') {
      expect(screen.getByRole('alert')).toHaveTextContent(/enter the product barcode manually/i);
    } else {
      expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    }
  });

  it('preserves a manual barcode when decoding finishes and validates before confirming', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    let finish!: (matches: { data: string }[]) => void;
    mockScanFromURLAsync.mockReturnValue(new Promise(resolve => { finish = resolve; }));

    await render(<CameraComponent />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));
    const input = screen.getByLabelText('Product barcode');
    await fireEvent.changeText(input, '0036000291453');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid product barcode.');

    await fireEvent.changeText(input, '0036000291452');
    await act(() => finish([{ data: '4006381333931' }]));
    expect(await screen.findByRole('button', { name: 'Barcode 4006381333931' })).toBeOnTheScreen();
    expect(input).toHaveDisplayValue('0036000291452');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
    expect(screen.getByText('Barcode confirmed · 0036000291452')).toBeOnTheScreen();
  });

  it('ignores an unfinished decode from a previous photo after retaking', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockPermission = { granted: false };
    mockChoosePhoto
      .mockResolvedValueOnce({ uri: 'file:///first.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' })
      .mockResolvedValueOnce({ uri: 'file:///second.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    let finishFirst!: (matches: { data: string }[]) => void;
    mockScanFromURLAsync
      .mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValueOnce([{ data: '4006381333931' }]);

    await render(<CameraComponent />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));
    await fireEvent.press(screen.getByRole('button', { name: /retake/i }));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));
    await act(() => finishFirst([{ data: '0036000291452' }]));

    expect(screen.getByRole('button', { name: 'Barcode 4006381333931' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Barcode 0036000291452' })).not.toBeOnTheScreen();
  });

  it('keeps the review on a catalog conflict and lets the shopper clear the barcode', async () => {
    const shop = { id: 'selected-shop', displayName: 'Selected shop' };
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockAddLocalProduct.mockRejectedValue(new Error('This barcode already has a saved product.'));
    mockSaveLocalPhoto.mockImplementation(async draft => draft);

    await render(<CameraComponent currentShop={shop} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));
    await fireEvent.changeText(screen.getByLabelText('Product barcode'), '0036000291452');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
    await fireEvent.changeText(screen.getByLabelText('Product name'), 'Fresh tomatoes');
    await fireEvent.changeText(screen.getByLabelText('Product type'), 'Tomatoes');
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.50');

    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This barcode already has a saved product.');
    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Fresh tomatoes');
    expect(screen.getByLabelText('Price photo preview')).toHaveProp('source', { uri: 'file:///cropped.jpg' });
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear barcode' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({ productId: undefined, shop }));
  });

  it('retries a failed photo save with the product ID already created', async () => {
    const shop = { id: 'selected-shop', displayName: 'Selected shop' };
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///original.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockAddLocalProduct.mockImplementation(async product => product);
    mockSaveLocalPhoto.mockRejectedValueOnce(new Error('Could not write the photo'))
      .mockImplementationOnce(async draft => draft);

    await render(<CameraComponent currentShop={shop} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));
    await fireEvent.changeText(screen.getByLabelText('Product barcode'), '0036000291452');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
    await fireEvent.changeText(screen.getByLabelText('Product name'), 'Fresh tomatoes');
    await fireEvent.changeText(screen.getByLabelText('Product type'), 'Tomatoes');
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.50');

    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/product saved.*photo is kept here/i);
    expect(screen.queryByRole('button', { name: 'Clear barcode' })).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.50');
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

    expect(mockAddLocalProduct).toHaveBeenCalledTimes(1);
    const [{ id }] = mockAddLocalProduct.mock.calls[0];
    expect(mockSaveLocalPhoto).toHaveBeenLastCalledWith(expect.objectContaining({
      productId: id, selected: expect.objectContaining({ uri: 'file:///cropped.jpg' }),
    }));
    expect(screen.getByText('On this phone')).toBeOnTheScreen();
  });

  it('saves a reviewed shelf photo with the selected shop and exact product', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const shop = { id: 'selected-shop', displayName: 'Selected shop' };
    const onSaved = jest.fn();
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///label.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockSaveLocalPhoto.mockImplementation(async (draft) => draft);
    await render(<CameraComponent currentShop={shop} linkedPrice={{ productId: 'exact-product', barcode: '5449000152473',
      initialReview: { productName: 'Known rice', shop: shop.displayName, price: '', currency: 'GBP', unit: '', unitPrice: '' },
      onCancel: jest.fn(), onSaved }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /apply crop/i }));

    expect(screen.getByText('Known rice')).toBeOnTheScreen();
    expect(screen.getByText('5449000152473')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Confirm barcode' })).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Product name')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save Price' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.50');
    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'exact-product', shop, capturedAt: expect.any(String),
      selected: expect.objectContaining({ uri: 'file:///cropped.jpg' }),
      review: expect.objectContaining({ productName: 'Known rice', price: '2.50' }),
    }));
    expect(mockScanFromURLAsync).not.toHaveBeenCalled();
    expect(mockAddLocalProduct).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('carries a scanned barcode into new-product photos and preserves it through crop and retake', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockPermission = { granted: false };
    const onCancel = jest.fn();
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///package.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    await render(<CameraComponent currentShop={{ id: 'shop', displayName: 'Shop' }}
      barcodeCapture={{ barcode: '036000291452', onCancel, onSaved: jest.fn() }} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Apply crop$/i }));
    expect(screen.getByLabelText('Product barcode')).toHaveDisplayValue('036000291452');
    expect(screen.getByRole('button', { name: 'Confirm barcode' })).toBeEnabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Save on this phone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/confirm the barcode/i);

    await fireEvent.press(screen.getByRole('button', { name: /^Retake$/i }));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Cancel crop$/i }));
    expect(screen.getByLabelText('Product barcode')).toHaveDisplayValue('036000291452');
    await fireEvent.press(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockAddLocalProduct).not.toHaveBeenCalled();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
  });

  it('scrolls to completed suggestions, then to the first field after applying', async () => {
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
    mockFieldPhotoAnalysisEnabled = true;
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///label.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    const draft = { product: 'Tomatoes', price: 1.49, currency: 'GBP', packSize: '500 g', unit_price: null, uncertainty: '' };
    let finish!: (result: typeof draft) => void;
    mockRequestPhotoDraft.mockReturnValue(new Promise<typeof draft>(resolve => { finish = resolve; }));
    await render(<CameraComponent currentShop={{ id: 'test-shop', displayName: 'Test shop' }} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Apply crop' }));
    await fireEvent(screen.getByText('Product').parent!, 'layout', { nativeEvent: { layout: { y: 240 } } });
    await fireEvent.changeText(screen.getByLabelText('Pack size'), '450 g');
    await fireEvent.press(screen.getByRole('button', { name: 'Analyse photo' }));

    expect(await screen.findByText('Analysing the selected photo…')).toBeOnTheScreen();
    expect(scrollTo).not.toHaveBeenCalled();
    await act(() => finish(draft));

    const heading = await screen.findByRole('header', { name: 'Suggested details' });
    const suggestion = heading.parent!;
    await fireEvent(suggestion, 'layout', { persist() {}, nativeEvent: { layout: { y: 160 } } });
    expect(scrollTo).toHaveBeenCalledWith({ y: 160, animated: false });
    await fireEvent(suggestion, 'layout', { persist() {}, nativeEvent: { layout: { y: 165 } } });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('');
    expect(screen.getByLabelText('Pack size')).toHaveDisplayValue('450 g');

    await fireEvent.press(screen.getByRole('button', { name: 'Use suggested details' }));

    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ y: 228, animated: false }));
    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Tomatoes');
    expect(screen.getByLabelText('Pack size')).toHaveDisplayValue('450 g');
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
  });

  it('drops a late price suggestion when the shopper opens the crop editor', async () => {
    mockFieldPhotoAnalysisEnabled = true;
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///label.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    const old = Promise.withResolvers<{ product: string; price: number; currency: string; unit_price: null; uncertainty: string }>();
    mockRequestPhotoDraft.mockReturnValue(old.promise);
    await render(<CameraComponent currentShop={{ id: 'test-shop', displayName: 'Test shop' }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Apply crop' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Analyse photo' }));
    await waitFor(() => expect(mockRequestPhotoDraft).toHaveBeenCalledTimes(1));
    const { signal } = mockRequestPhotoDraft.mock.lastCall?.[0];
    await fireEvent.press(screen.getByRole('button', { name: 'Crop photo' }));
    expect(signal.aborted).toBe(true);
    await fireEvent.press(await screen.findByRole('button', { name: 'Apply crop' }));
    await act(async () => { old.resolve({ product: 'Old crop', price: 2.2, currency: 'GBP', unit_price: null, uncertainty: '' }); });
    expect(screen.getByLabelText('Product name')).toHaveDisplayValue('');
    expect(screen.queryByText('Old crop')).not.toBeOnTheScreen();
  });

  it.each(['active-shop', 'other-shop'])('only sends the active shop hint for a matching saved photo (%s)', async (savedShopId) => {
    mockFieldPhotoAnalysisEnabled = true;
    mockPermission = { granted: false };
    const photo = { uri: 'file:///label.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' };
    const shopCountry = { country: 'United Kingdom', source: 'postcode pattern' } as const;
    mockLoadLocalPhotos.mockResolvedValue([{
      id: 'saved', capturedAt: '2026-11-18T15:00:00Z',
      original: photo, selected: photo, shop: { id: savedShopId, displayName: 'Saved branch' },
    }]);
    mockRequestPhotoDraft.mockResolvedValue({ product: 'Tomatoes', price: 1.49, currency: 'GBP', unit_price: null, uncertainty: '' });
    await render(<CameraComponent currentShop={{ id: 'active-shop', displayName: 'Active branch' }} currentShopCountry={shopCountry} />);
    await fireEvent.press(await screen.findByRole('button', { name: /^Review / }));
    await fireEvent.press(screen.getByRole('button', { name: 'Analyse photo' }));
    await waitFor(() => expect(mockRequestPhotoDraft).toHaveBeenCalledWith(expect.objectContaining({
      shopCountry: savedShopId === 'active-shop' ? shopCountry : undefined,
    })));
  });

  it('keeps selected-photo OCR local until the shopper asks for analysis', async () => {
    mockFieldPhotoAnalysisEnabled = true;
    mockPermission = { granted: false };
    const photo = { uri: 'file:///label.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' };
    const ocr = { status: 'found', evidence: { width: 1200, height: 800, blocks: [{ lines: [{ text: '£1.49', elements: [] }] }] } };
    mockReadPhotoText.mockResolvedValue(ocr);
    mockLoadLocalPhotos.mockResolvedValue([{ id: 'saved', capturedAt: '2026-11-18T15:00:00Z', original: photo, selected: photo }]);
    mockRequestPhotoDraft.mockResolvedValue({ product: 'Tomatoes', price: 1.49, currency: 'GBP', unit_price: null, uncertainty: '' });
    await render(<CameraComponent />);
    await fireEvent.press(await screen.findByRole('button', { name: /^Review / }));
    expect(mockReadPhotoText).toHaveBeenCalledWith(photo.uri);
    expect(mockRequestPhotoDraft).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Analyse photo' }));
    await waitFor(() => expect(mockRequestPhotoDraft).toHaveBeenCalledWith(expect.objectContaining({
      sourcePhoto: photo, photoText: { photo, result: ocr },
    })));
  });

  it('confirms a clear retained product photo once without AI and keeps its evidence', async () => {
    mockPermission = { granted: false };
    const photo = { uri: 'file:///label.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' } as const;
    const product = { id: 'known', name: 'Example Rice', pack: { quantity: 500, unit: 'g' } };
    const sourcePhoto = { original: photo, selected: photo, capturedAt: '2026-11-20T12:00:00Z' };
    const shop = { id: 'selected-shop', displayName: 'Example Market' };
    const initialReview = { productName: product.name, price: '', currency: 'GBP', shop: shop.displayName, packSize: '500 g', unitPrice: '', unit: '' };
    mockReadPhotoText.mockImplementation(async (uri: string) => ({ status: 'found', evidence: { width: 1200, height: 800, blocks: [{ lines: [
      { text: 'Example Rice 500 g', box: [0.1, 0.1, 0.4, 0.14], elements: [] },
      { text: uri.endsWith('cropped.jpg') ? '£3.50' : '£2.50', box: [0.1, 0.17, 0.25, 0.22], elements: [] },
    ] }] } }));
    mockSaveLocalPhoto.mockImplementation(async draft => draft);
    await render(<CameraComponent currentShop={shop} linkedPrice={{ productId: product.id, product, sourcePhoto, initialReview,
      onCancel: jest.fn(), onSaved: jest.fn() }} />);
    await waitFor(() => expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.50'));
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    expect(mockRequestPhotoDraft).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Crop photo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply crop' }));
    await waitFor(() => expect(mockReadPhotoText).toHaveBeenCalledWith('file:///cropped.jpg'));
    expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('');
    expect(screen.getByRole('button', { name: 'Confirm current price' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Use original' }));
    await waitFor(() => expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.50'));

    await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
    expect(mockSaveLocalPhoto).toHaveBeenCalledTimes(1);
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({ ...sourcePhoto, shop, productId: product.id,
      review: expect.objectContaining({ price: '2.50', currency: 'GBP' }),
    }));
  });

  it('applies the chosen price only on request and preserves a manual correction', async () => {
    mockFieldPhotoAnalysisEnabled = true;
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///label.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockRequestPhotoDraft.mockResolvedValue({
      product: 'Tomatoes', brand: 'Original brand', price: 1.49, currency: 'GBP', packSize: '500 g',
      unit_price: null, uncertainty: '', alternatives: { price: [1.79], brand: ['Other brand'] },
    });
    await render(<CameraComponent currentShop={{ id: 'test-shop', displayName: 'Test shop' }} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Apply crop' }));
    await fireEvent.changeText(screen.getByLabelText('Brand'), 'My corrected brand');
    await fireEvent.press(screen.getByRole('button', { name: 'Analyse photo' }));

    const primaryPrice = await screen.findByRole('radio', { name: 'Total price: £1.49' });
    expect(primaryPrice).toBeChecked();
    expect(screen.getByText('Printed unit price unconfirmed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Total price: £1.79' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Brand: Other brand' }));
    expect(primaryPrice).not.toBeChecked();
    expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('');

    await fireEvent.press(screen.getByRole('button', { name: 'Use suggested details' }));

    expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('1.79');
    expect(screen.getByLabelText('Brand')).toHaveDisplayValue('My corrected brand');
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'suggested size', suggestion: '500 g', editBefore: undefined, editAfter: undefined, savedSize: '500 g' },
    { label: 'previously entered size', suggestion: '500 g', editBefore: '450 g', editAfter: undefined, savedSize: '450 g' },
    { label: 'corrected suggestion', suggestion: '500 g', editBefore: undefined, editAfter: '450 g', savedSize: '450 g' },
    { label: 'manual entry for an unknown size', suggestion: null, editBefore: undefined, editAfter: '450 g', savedSize: '450 g' },
  ])('saves the $label through the photo review', async ({ suggestion, editBefore, editAfter, savedSize }) => {
    mockFieldPhotoAnalysisEnabled = true;
    mockPermission = { granted: false };
    mockChoosePhoto.mockResolvedValue({ uri: 'file:///label.jpg', width: 1200, height: 800, mimeType: 'image/jpeg' });
    mockRequestPhotoDraft.mockResolvedValue({ product: 'Tomatoes', price: 1.49, currency: 'GBP', packSize: suggestion, unit_price: null, uncertainty: '' });
    mockSaveLocalPhoto.mockImplementation(async (draft) => draft);
    await render(<CameraComponent currentShop={{ id: 'test-shop', displayName: 'Test shop' }} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Apply crop' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Analyse photo' }));
    const applySuggestion = await screen.findByRole('button', { name: 'Use suggested details' });
    if (suggestion) expect(screen.getByRole('radio', { name: `Pack size: ${suggestion}` })).toBeChecked();
    else expect(screen.getByText('Pack size unconfirmed')).toBeOnTheScreen();
    if (editBefore) await fireEvent.changeText(screen.getByLabelText('Pack size'), editBefore);
    await fireEvent.press(applySuggestion);
    expect(screen.getByLabelText('Pack size')).toHaveDisplayValue(editBefore ?? suggestion ?? '');
    if (editAfter) await fireEvent.changeText(screen.getByLabelText('Pack size'), editAfter);

    await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
    expect(await screen.findByText('On this phone')).toBeOnTheScreen();
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({
      review: expect.objectContaining({ packSize: savedSize }),
    }));
  });

  it("keeps capture controls disabled while the photo picker is open", async () => {
    mockPermission = { granted: true };
    const user = userEvent.setup();
    let cancelPicker!: () => void;
    mockChoosePhoto.mockReturnValue(new Promise<void>(resolve => { cancelPicker = resolve; }));
    await render(<CameraComponent />);
    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");

    await user.press(screen.getByRole("button", { name: "Choose photo" }));

    const opening = screen.getByRole("button", { name: "Opening photos…" });
    expect(opening).toBeBusy();
    expect(opening).toBeDisabled();
    expect(screen.getByRole("button", { name: "Take Picture of Price" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Flip Camera" })).toBeDisabled();
    await act(() => cancelPicker());
    expect(screen.getByRole("button", { name: "Take Picture of Price" })).toBeEnabled();
    expect(mockTakePictureAsync).not.toHaveBeenCalled();
  });

  it("shows no camera controls while the permission response is loading", async () => {
    jest.spyOn(Image, "getSize").mockImplementation((uri, success) => { success?.(1200, 800); return Promise.resolve({ width: 1200, height: 800 }); });
    mockPermission = null;
    await render(<CameraComponent />);

    expect(screen.queryByText("Grant Permission")).toBeNull();
    expect(screen.queryByTestId("camera-preview")).toBeNull();
  });

  it("captures a photo and returns to the camera when Retake is pressed", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///test-photo.jpg", width: 1200, height: 800 });
    await render(<CameraComponent />);

    const captureButton = screen.getByText("Preparing camera…");
    await fireEvent.press(captureButton);
    expect(mockTakePictureAsync).not.toHaveBeenCalled();

    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    if (screen.queryByText("Cancel crop")) await fireEvent.press(screen.getByText("Cancel crop"));

    expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Retake")).toBeTruthy();
    expect(screen.getByText("Save on this phone")).toBeTruthy();

    await fireEvent.press(screen.getByText("Retake"));

    expect(screen.getByText("Preparing camera…")).toBeTruthy();
    expect(screen.queryByText("Retake")).toBeNull();

    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    expect(screen.getByText("Take Picture of Price")).toBeTruthy();
  });

  it("previews an explicitly selected development test photo and can retake", async () => {
    mockPermission = { granted: true };
    process.env.EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL = "http://10.0.2.2:8767/test-photo.jpg";
    await render(<CameraComponent />);
    await fireEvent.press(screen.getByText("Use test photo"));
    expect(screen.getByLabelText("Price photo preview")).toHaveProp("source", {
      uri: "http://10.0.2.2:8767/test-photo.jpg",
    });
    expect(screen.getByText("Save on this phone")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Retake"));
    expect(screen.getByTestId("camera-preview")).toBeOnTheScreen();
    delete process.env.EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL;
  });

  it("can view the fixture without granting camera permission and reports load errors", async () => {
    mockPermission = { granted: false };
    process.env.EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL = "http://10.0.2.2:8767/test-photo.jpg";
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<CameraComponent />);
    await fireEvent.press(screen.getByText("Use test photo"));
    await fireEvent(screen.getByLabelText("Price photo preview"), "error");
    expect(alertSpy).toHaveBeenCalledWith("Photo unavailable", expect.any(String));
    expect(screen.getByText("Grant Permission")).toBeOnTheScreen();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it("explains how to enable the missing test fixture", async () => {
    mockPermission = { granted: true };
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<CameraComponent />);
    await fireEvent.press(screen.getByText("Use test photo"));
    expect(alertSpy).toHaveBeenCalledWith("Test photo unavailable", expect.any(String));
    expect(screen.queryByText("Retake")).not.toBeOnTheScreen();
  });

  it("shows an alert when taking a photo fails", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockRejectedValue(new Error("Camera unavailable"));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<CameraComponent />);

    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    if (screen.queryByText("Cancel crop")) await fireEvent.press(screen.getByText("Cancel crop"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Unable to take photo",
        "Please try again.",
      );
    });
    expect(screen.getByText("Take Picture of Price")).toBeTruthy();
  });

  it("crops, cancels and resets to the original before saving locally", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///original.jpg", width: 1200, height: 800 });
    mockSaveLocalPhoto.mockImplementation(async value => value);
    await render(<CameraComponent />);
    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    if (screen.queryByText("Cancel crop")) await fireEvent.press(screen.getByText("Cancel crop"));
    await fireEvent.press(await screen.findByText("Crop photo"));
    await fireEvent.press(screen.getByText("Cancel crop"));
    expect(screen.getByLabelText("Price photo preview")).toHaveProp("source", { uri: "file:///original.jpg" });
    await fireEvent.press(screen.getByText("Crop photo"));
    await fireEvent.press(screen.getByText("Apply crop"));
    expect(screen.getByLabelText("Price photo preview")).toHaveProp("source", { uri: "file:///cropped.jpg" });
    await fireEvent.changeText(screen.getByLabelText("Product type"), "Dry rice");
    await fireEvent.changeText(screen.getByLabelText("Variety"), "Basmati");
    await fireEvent.changeText(screen.getByLabelText("Brand"), "Example brand");
    await fireEvent.press(screen.getByText("Save on this phone"));
    expect(await screen.findByText("On this phone")).toBeOnTheScreen();
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({ original: expect.objectContaining({ uri: "file:///original.jpg" }), selected: { uri: "file:///cropped.jpg", width: 200, height: 100, mimeType: "image/jpeg" } }));
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({ review: expect.objectContaining({ productType: "Dry rice", variety: "Basmati", brand: "Example brand" }) }));
    await fireEvent.press(screen.getByText("Use original"));
    expect(screen.getByLabelText("Price photo preview")).toHaveProp("source", { uri: "file:///original.jpg" });
  });

  it("keeps the preview and reports a failed local save without success", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///original.jpg", width: 1200, height: 800 });
    mockSaveLocalPhoto.mockRejectedValue(Error("Disk full"));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<CameraComponent />);
    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    if (screen.queryByText("Cancel crop")) await fireEvent.press(screen.getByText("Cancel crop"));
    await fireEvent.press(await screen.findByText("Save on this phone"));
    expect(alertSpy).toHaveBeenCalledWith("Photo not saved", expect.any(String));
    expect(screen.queryByText("On this phone")).not.toBeOnTheScreen();
    expect(screen.getByLabelText("Price photo preview")).toBeOnTheScreen();
  });
  it("keeps manual details and reuses the confirmed shop for another capture", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///original.jpg", width: 1200, height: 800 });
    mockSaveLocalPhoto.mockImplementation(async value => value);
    await render(<CameraComponent />);
    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    if (screen.queryByText("Cancel crop")) await fireEvent.press(screen.getByText("Cancel crop"));
    await fireEvent.changeText(screen.getByLabelText("Product name"), "Milk 2 litres");
    await fireEvent.changeText(screen.getByLabelText("Pack price"), "1.65");
    await fireEvent.changeText(screen.getByLabelText("Confirmed shop"), "Tesco Borough Road");
    await fireEvent.press(screen.getByText("Save Price"));
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({ review: expect.objectContaining({ productName: "Milk 2 litres", price: "1.65", shop: "Tesco Borough Road", currency: "GBP" }) }));
    await fireEvent.press(screen.getByText("Retake"));
    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    if (screen.queryByText("Cancel crop")) await fireEvent.press(screen.getByText("Cancel crop"));
    expect(screen.getByLabelText("Confirmed shop")).toHaveDisplayValue("Tesco Borough Road");
    expect(screen.getByLabelText("Product name")).toHaveDisplayValue("");
  });

  it("keeps field labels visible after values are entered", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///label-photo.jpg", width: 1200, height: 800 });
    await render(<CameraComponent />);
    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    if (screen.queryByText("Cancel crop")) await fireEvent.press(screen.getByText("Cancel crop"));
    await fireEvent.changeText(screen.getByLabelText("Product name"), "Rice 1kg");
    await fireEvent.changeText(screen.getByLabelText("Pack price"), "1.25");
    expect(screen.getByText("Product")).toBeOnTheScreen();
    expect(screen.getByText("Total price (GBP)")).toBeOnTheScreen();
    expect(screen.getByText("Shop")).toBeOnTheScreen();
    expect(screen.getByText("Unit price (optional)")).toBeOnTheScreen();
    expect(screen.getByText("Unit (kg / 100g / litre / each)")).toBeOnTheScreen();
    expect(screen.getByLabelText("Product name")).toHaveDisplayValue("Rice 1kg");
    expect(screen.getByRole("button", { name: "Save on this phone" })).toBeEnabled();
  });

  it("keeps a draft's original shop through save and uses the new shop on the next capture", async () => {
    const firstShop = { id: "lidl", displayName: "Tandem Centre Lidl" };
    const nextShop = { id: "tesco", displayName: "Tesco Borough Road" };
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///price.jpg", width: 1200, height: 800 });
    mockSaveLocalPhoto.mockImplementation(async value => value);
    await render(<CameraComponent currentShop={firstShop} />);

    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    await fireEvent.press(await screen.findByText("Apply crop"));
    expect(screen.getByLabelText(`Confirmed shop: ${firstShop.displayName}`)).toHaveTextContent(firstShop.displayName);

    await screen.rerender(<CameraComponent currentShop={nextShop} />);
    await fireEvent.press(screen.getByText("Save on this phone"));
    expect(mockSaveLocalPhoto).toHaveBeenLastCalledWith(expect.objectContaining({
      shop: firstShop,
      review: expect.objectContaining({ shop: firstShop.displayName }),
    }));

    await fireEvent.press(screen.getByText("Retake"));
    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    await fireEvent.press(await screen.findByText("Apply crop"));
    expect(screen.getByLabelText(`Confirmed shop: ${nextShop.displayName}`)).toHaveTextContent(nextShop.displayName);
    await fireEvent.press(screen.getByText("Save on this phone"));
    expect(mockSaveLocalPhoto).toHaveBeenLastCalledWith(expect.objectContaining({ shop: nextShop }));

    await fireEvent.press(screen.getByText("Retake"));
    await fireEvent.press(screen.getAllByRole("button", { name: /^Review / })[1]);
    expect(screen.getByLabelText(`Confirmed shop: ${firstShop.displayName}`)).toHaveTextContent(firstShop.displayName);
  });

  it("opens an editable crop after capture without saving or replacing the original", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///full-original.jpg", width: 3000, height: 4000 });
    await render(<CameraComponent />);
    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    expect(await screen.findByText("Cancel crop")).toBeOnTheScreen();
    expect(mockSaveLocalPhoto).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Cancel crop"));
    expect(screen.getByLabelText("Price photo preview")).toHaveProp("source", { uri: "file:///full-original.jpg" });
  });

});
