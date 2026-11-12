import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import DeveloperTools from "../app/developer-tools";
import HomeScreen from "../app/index";
import ScanScreen from "../app/scan";
import { loadSavedShops, removeShop, saveShop, updateShop } from "../data/local-shops";

const mockPush = jest.fn();
const mockExtra = { directAuthTest: false };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]),
  Stack: { Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => options.headerRight?.() ?? null },
  Redirect: () => null,
}));

jest.mock("expo-constants", () => ({ expoConfig: { get extra() { return mockExtra; } } }));
jest.mock("../data/local-shops", () => ({ loadSavedShops: jest.fn(), saveShop: jest.fn(), selectShop: jest.fn(), updateShop: jest.fn(), removeShop: jest.fn() }));
jest.mock("../component/camera", () => ({
  CameraComponent: ({ currentShop }: { currentShop?: { displayName: string } }) => {
    const { Text } = require("react-native");
    return <Text>{`Camera for ${currentShop?.displayName ?? "no shop"}`}</Text>;
  },
}));

beforeEach(() => {
  mockPush.mockReset();
  mockExtra.directAuthTest = false;
  jest.mocked(loadSavedShops).mockResolvedValue({ shops: [] });
  jest.mocked(saveShop).mockReset();
  jest.mocked(updateShop).mockReset();
  jest.mocked(removeShop).mockReset();
});

test("a direct visit to Scan waits for a shop to be saved before mounting the camera", async () => {
  const shop = { id: "lidl-1", nickname: "Tandem Centre Lidl" };
  jest.mocked(saveShop).mockResolvedValue({ shops: [shop], currentShop: shop });
  await render(<ScanScreen />);

  expect(screen.queryByText(/^Camera for/)).not.toBeOnTheScreen();
  await fireEvent.press(await screen.findByRole("button", { name: "Add a shop" }));
  await fireEvent.changeText(screen.getByLabelText("Nickname"), shop.nickname);
  await fireEvent.press(screen.getByRole("button", { name: "Save shop" }));

  expect(await screen.findByText("Camera for Tandem Centre Lidl")).toBeOnTheScreen();
  expect(saveShop).toHaveBeenCalledWith(expect.objectContaining({ nickname: shop.nickname }), { select: true });
});

test("restores the current shop on Home and opens a selected visit directly in Scan", async () => {
  const shop = { id: "lidl-1", name: "Lidl", nickname: "Tandem Centre Lidl" };
  jest.mocked(loadSavedShops).mockResolvedValue({ shops: [shop], currentShop: shop });

  await render(<HomeScreen />);
  expect(await screen.findByText("You're at: Tandem Centre Lidl")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Change shop" })).toBeOnTheScreen();

  await screen.rerender(<ScanScreen />);
  expect(await screen.findByText("Camera for Tandem Centre Lidl")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Add a shop" })).not.toBeOnTheScreen();
});

test("retries a failed shop read before allowing capture", async () => {
  jest.mocked(loadSavedShops).mockRejectedValueOnce(Error("Read failed"));
  await render(<ScanScreen />);

  expect(await screen.findByRole("alert")).toHaveTextContent(/Could not read saved shops/);
  expect(screen.queryByText(/^Camera for/)).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Add a shop" })).toBeOnTheScreen();
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


test("edits a saved shop in place and refreshes the current label on Home", async () => {
  const shop = { id: "shop-1", nickname: "Market", address: "Old address" };
  const updated = { ...shop, nickname: "My market", address: "12 Market Road" };
  jest.mocked(loadSavedShops).mockResolvedValue({ shops: [shop], currentShop: shop });
  jest.mocked(updateShop).mockRejectedValueOnce(Error("Could not save your shop changes."));
  jest.mocked(updateShop).mockResolvedValueOnce({ shops: [updated], currentShop: updated });
  await render(<HomeScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "Change shop" }));
  await fireEvent.press(screen.getByRole("button", { name: "Edit Market" }));
  expect(screen.getByLabelText("Address (optional)")).toHaveDisplayValue(shop.address);
  await fireEvent.changeText(screen.getByLabelText("Address (optional)"), "Unsaved address");
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(updateShop).not.toHaveBeenCalled();
  expect(screen.getByText(shop.address)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Edit Market" }));
  await fireEvent.changeText(screen.getByLabelText("Nickname"), updated.nickname);
  await fireEvent.changeText(screen.getByLabelText("Address (optional)"), updated.address);
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save your shop changes.");
  expect(screen.getByLabelText("Address (optional)")).toHaveDisplayValue(updated.address);
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  expect(updateShop).toHaveBeenLastCalledWith(shop.id, { nickname: updated.nickname, name: "", address: updated.address });
  expect(saveShop).not.toHaveBeenCalled();
  expect(screen.getByText(updated.address)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("You're at: My market")).toBeOnTheScreen();
});

test("cancels removal safely and clears the current shop only after confirmed removal", async () => {
  const shop = { id: "shop-1", nickname: "Market" };
  jest.mocked(loadSavedShops).mockResolvedValue({ shops: [shop], currentShop: shop });
  jest.mocked(removeShop).mockRejectedValueOnce(Error("Could not save your shop changes."));
  jest.mocked(removeShop).mockResolvedValueOnce({ shops: [] });
  await render(<HomeScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: "Change shop" }));
  await fireEvent.press(screen.getByRole("button", { name: "Edit Market" }));
  await fireEvent.press(screen.getByRole("button", { name: "Remove shop" }));
  expect(screen.getByRole("header", { name: "Remove Market?" })).toBeOnTheScreen();
  expect(screen.getByText(/Previous prices and photos will be kept/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(removeShop).not.toHaveBeenCalled();
  expect(screen.getByRole("header", { name: "Edit shop" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Remove shop" }));
  await fireEvent.press(screen.getByRole("button", { name: "Remove shop" }));
  expect(removeShop).toHaveBeenCalledWith(shop.id);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save your shop changes.");
  expect(screen.getByRole("header", { name: "Remove Market?" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Remove shop" }));
  expect(screen.getByText("No saved shops yet")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Select current shop" })).toBeOnTheScreen();
});
