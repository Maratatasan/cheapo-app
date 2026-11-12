import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import DeveloperTools from "../app/developer-tools";
import HomeScreen from "../app/index";

const mockPush = jest.fn();
const mockExtra = { directAuthTest: false };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: { Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => options.headerRight?.() ?? null },
  Redirect: () => null,
}));

jest.mock("expo-constants", () => ({ expoConfig: { get extra() { return mockExtra; } } }));

beforeEach(() => {
  mockPush.mockReset();
  mockExtra.directAuthTest = false;
});

test("opens Scan and sample prices from Home", async () => {
  await render(<HomeScreen />);

  expect(screen.queryByRole("button", { name: "Developer tools" })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Scan item" }));
  await fireEvent.press(screen.getByRole("button", { name: "Explore sample prices" }));

  expect(mockPush).toHaveBeenNthCalledWith(1, "/scan");
  expect(mockPush).toHaveBeenNthCalledWith(2, "/results");
});

test("opens the sign-in experiment from a separate screen in the flagged build", async () => {
  mockExtra.directAuthTest = true;
  await render(<HomeScreen />);

  expect(screen.queryByRole("button", { name: "Direct phone sign-in test" })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Developer tools" }));
  expect(mockPush).toHaveBeenLastCalledWith("/developer-tools");

  await screen.rerender(<DeveloperTools />);
  await fireEvent.press(screen.getByRole("button", { name: "Direct phone sign-in test" }));
  expect(mockPush).toHaveBeenLastCalledWith("/direct-auth");
});

test("keeps experiment controls off the developer screen in ordinary builds", async () => {
  await render(<DeveloperTools />);

  expect(screen.queryByRole("button", { name: "Direct phone sign-in test" })).not.toBeOnTheScreen();
});
