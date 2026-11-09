/// <reference types="jest" />

import React from "react";
import { Alert } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { CameraComponent } from "../component/camera";

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
    mockPermission = null;
    mockRequestPermission.mockReset();
    mockTakePictureAsync.mockReset();
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
    mockPermission = null;
    await render(<CameraComponent />);

    expect(screen.queryByText("Grant Permission")).toBeNull();
    expect(screen.queryByTestId("camera-preview")).toBeNull();
  });

  it("captures a photo and returns to the camera when Retake is pressed", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///test-photo.jpg" });
    await render(<CameraComponent />);

    const captureButton = screen.getByText("Preparing camera…");
    await fireEvent.press(captureButton);
    expect(mockTakePictureAsync).not.toHaveBeenCalled();

    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));

    expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Retake")).toBeTruthy();
    expect(screen.getByText("Upload Photo")).toBeTruthy();

    await fireEvent.press(screen.getByText("Retake"));

    expect(screen.getByText("Preparing camera…")).toBeTruthy();
    expect(screen.queryByText("Retake")).toBeNull();

    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    expect(screen.getByText("Take Picture of Price")).toBeTruthy();
  });

  it("shows an alert when taking a photo fails", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockRejectedValue(new Error("Camera unavailable"));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<CameraComponent />);

    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Unable to take photo",
        "Please try again.",
      );
    });
    expect(screen.getByText("Take Picture of Price")).toBeTruthy();
  });

  it("returns to the camera after the upload stub confirms the photo", async () => {
    mockPermission = { granted: true };
    mockTakePictureAsync.mockResolvedValue({ uri: "file:///test-photo.jpg" });
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await render(<CameraComponent />);

    await fireEvent(screen.getByTestId("camera-preview"), "cameraReady");
    await fireEvent.press(screen.getByText("Take Picture of Price"));
    await screen.findByText("Upload Photo");
    await fireEvent.press(screen.getByText("Upload Photo"));

    expect(logSpy).toHaveBeenCalledWith("Uploading photo:", "file:///test-photo.jpg");
    expect(alertSpy).toHaveBeenCalledWith(
      "✅ Photo uploaded!",
      "file:///test-photo.jpg",
    );
    expect(screen.getByTestId("camera-preview")).toBeTruthy();
    expect(screen.queryByText("Upload Photo")).toBeNull();
  });
});
