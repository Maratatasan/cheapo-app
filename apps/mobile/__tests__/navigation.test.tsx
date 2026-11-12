/// <reference types="jest" />

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import HomeScreen from "../app/index";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("home navigation", () => {
  beforeEach(() => mockPush.mockReset());

  it("opens the scan route when the user chooses Scan price", async () => {
    await render(<HomeScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Scan price" }));

    expect(mockPush).toHaveBeenCalledWith("/scan");
  });
});
