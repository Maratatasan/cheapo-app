/// <reference types="jest" />

import React from "react";
import { Alert, Image } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { CameraComponent } from "../component/camera";

const mockSaveLocalPhoto = jest.fn();
const mockLoadLocalPhotos = jest.fn();
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
    mockSaveLocalPhoto.mockReset();
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

    await fireEvent.press(screen.getByText("Grant Permission"));

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
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
    await fireEvent.press(screen.getByText("Save on this phone"));
    expect(await screen.findByText("On this phone")).toBeOnTheScreen();
    expect(mockSaveLocalPhoto).toHaveBeenCalledWith(expect.objectContaining({ original: expect.objectContaining({ uri: "file:///original.jpg" }), selected: { uri: "file:///cropped.jpg", width: 200, height: 100, mimeType: "image/jpeg" } }));
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
    await fireEvent.press(screen.getByText("Save on this phone"));
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
    expect(screen.getByText("Price (GBP)")).toBeOnTheScreen();
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
