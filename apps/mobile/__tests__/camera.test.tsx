/// <reference types="jest" />

import React from "react";
import { Alert, Image } from "react-native";
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
const mockChoosePhoto = jest.fn();
let mockFieldPhotoAnalysisEnabled = false;
const mockRequestPhotoDraft = jest.fn();
jest.mock('../lib/direct-auth/photo-analysis', () => ({ requestPhotoDraft: (...args: unknown[]) => mockRequestPhotoDraft(...args) }));
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
  return React.createElement(View, null, React.createElement(Button, { title: 'Apply crop', onPress: () => onApply({ uri: 'file:///cropped.jpg', width: 200, height: 100, mimeType: 'image/jpeg' }) }), React.createElement(Button, { title: 'Cancel crop', onPress: onCancel }));
} }));
const mockRequestPermission = jest.fn();
const mockTakePictureAsync = jest.fn();
let mockPermission: { granted: boolean } | null = null;

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
      });
    }),
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});

describe("CameraComponent", () => {
  beforeEach(() => {
    jest.spyOn(Image, "getSize").mockImplementation((uri, success) => { success?.(1200, 800); return Promise.resolve({ width: 1200, height: 800 }); });
    mockPermission = null;
    mockFieldPhotoAnalysisEnabled = false;
    mockRequestPhotoDraft.mockReset();
    mockSaveLocalPhoto.mockReset();
    mockChoosePhoto.mockReset();
    mockLoadLocalPhotos.mockResolvedValue([]);
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
    expect(screen.getByText(`Brand unconfirmed · ${suggestion ?? 'Pack size unconfirmed'}`)).toBeOnTheScreen();
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
