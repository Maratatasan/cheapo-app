import React from "react";
import { render, screen, userEvent } from "@testing-library/react-native";
import { ShopsBrowser } from "../component/results/shops-browser";
import { sampleObservations } from "../data/sample-observations";
jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View, Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
    Marker: ({ title, onPress }: { title: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});
jest.useFakeTimers();
it("selects a shop from its map pin and from its list card", async () => {
  const user = userEvent.setup();
  await render(<ShopsBrowser observations={sampleObservations} />);
  await user.press(
    screen.getByRole("button", { name: "2. Aldi · illustrative pin" }),
  );
  expect(screen.getByRole("button", { name: /Select Aldi/ })).toBeSelected();
  await user.press(screen.getByRole("button", { name: /Select Lidl/ }));
  expect(screen.getByRole("button", { name: /Select Lidl/ })).toBeSelected();
});
it("handles an empty shop collection without a selected observation", async () => {
  await render(<ShopsBrowser observations={[]} />);
  expect(
    screen.getByText("No sample shop positions to show."),
  ).toBeOnTheScreen();
  expect(screen.queryAllByLabelText(/^Observation:/)).toHaveLength(0);
});
