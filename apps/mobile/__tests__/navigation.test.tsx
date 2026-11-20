import type { ReactNode } from "react";
import { Platform } from "react-native";
import { fireEvent, render as renderScreen, screen } from "@testing-library/react-native";
import type { CameraComponent } from "../component/camera";
import DeveloperTools from "../app/developer-tools";
import HomeScreen from "../app/index";
import ScanScreen from "../app/scan";
import FindProductScreen from "../app/find-product";
import { ShopRepositoryProvider } from "../component/shop/shop-repository-provider";
import type { ShopRepository } from "../data/shop-repository";
import type { BarcodeScan } from "../component/barcode-scan";
import { productPhotoPriceSources } from "../data/photo-price-source";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockProductLookup = jest.fn();
const mockBarcodeProps = jest.fn();
const mockSearchProductCandidates = jest.fn();
let mockEnrolled = false;
const mockEnrolledRuntime = { owner: {}, subscribeSync: jest.fn() };
let mockScanParams: { mode?: string; barcode?: string; photoSource?: string } = {};
const mockExtra = { directAuthTest: false, fieldTest: false, cheapoApiOrigin: "" };
const testShopRepository = {
  loadSavedShops: jest.fn<ReturnType<ShopRepository["loadSavedShops"]>, []>(),
  saveShop: jest.fn(),
  selectShop: jest.fn(),
  updateShop: jest.fn(),
  removeShop: jest.fn(),
} satisfies ShopRepository;
const { loadSavedShops, saveShop, updateShop, removeShop } = testShopRepository;

function WithShopRepository({ children }: { children: ReactNode }) {
  return <ShopRepositoryProvider repository={testShopRepository}>{children}</ShopRepositoryProvider>;
}

function render(ui: Parameters<typeof renderScreen>[0]) {
  return renderScreen(ui, { wrapper: WithShopRepository });
}

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockScanParams,
  useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]),
  Stack: { Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => options.headerRight?.() ?? null },
  Redirect: () => null,
}));

jest.mock("../component/barcode-scan", () => ({
  BarcodeScan: (props: Parameters<typeof BarcodeScan>[0]) => {
    mockBarcodeProps(props);
    const { currentShop, onScanLabel } = props;
    const { Button, Text, View } = require("react-native");
    return <View><Text>{currentShop ? `Barcode lookup · ${currentShop.displayName}` : "Barcode lookup"}</Text>
      <Button title="Scan label" onPress={onScanLabel} /></View>;
  },
}));

jest.mock("expo-constants", () => ({ expoConfig: { get extra() { return mockExtra; } } }));
jest.mock("../component/cheapo-shopping-provider", () => ({ useCheapoShopping: () => mockEnrolled ? mockEnrolledRuntime : null }));
jest.mock("../data/cheapo-shopping-read-device", () => ({ createOwnerShoppingReads: () => ({
  searchProductCandidates: mockSearchProductCandidates,
}) }));
jest.mock("../component/camera", () => ({
  CameraComponent: ({ currentShop, productLookup }: Parameters<typeof CameraComponent>[0]) => {
    const { Text } = require("react-native");
    if (productLookup) mockProductLookup(productLookup);
    return <Text>{productLookup ? "Packaging lookup camera" : `Camera for ${currentShop?.displayName ?? "no shop"}`}</Text>;
  },
}));

beforeEach(() => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockProductLookup.mockReset();
  mockBarcodeProps.mockReset();
  mockSearchProductCandidates.mockReset();
  mockEnrolled = false;
  mockScanParams = {};
  mockExtra.directAuthTest = false;
  mockExtra.fieldTest = false;
  mockExtra.cheapoApiOrigin = "";
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

test("opens a packaging lookup without needing a saved shop and keeps sample prices available", async () => {
  await render(<HomeScreen />);

  expect(screen.queryByRole("button", { name: "Developer tools" })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Scan item" }));
  await fireEvent.press(screen.getByRole("button", { name: "Explore sample prices" }));

  expect(mockPush).toHaveBeenNthCalledWith(1, { pathname: "/scan", params: { mode: "lookup" } });
  expect(mockPush).toHaveBeenNthCalledWith(2, "/results");
  mockScanParams = { mode: "lookup" };
  await screen.rerender(<ScanScreen />);
  expect(screen.getByText("Packaging lookup camera")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Add a shop" })).not.toBeOnTheScreen();
});

test("opens comparison only from a chosen packaging match and keeps the two ID types distinct", async () => {
  mockEnrolled = true;
  mockScanParams = { mode: "lookup" };
  const catalog = { kind: "catalog", product: { id: "canonical-oats", name: "Oats" } };
  const observation = { kind: "unlinked_observation", observationId: "fa91641f-d265-4a3b-9695-4ff553ab5138", details: { name: "Oats" } };
  const value = { candidates: [catalog, observation], truncated: false };
  mockSearchProductCandidates.mockResolvedValue({ status: "fresh", value });
  await render(<ScanScreen />);
  const { candidateLookup } = mockProductLookup.mock.lastCall?.[0];
  await expect(candidateLookup.findCandidates({ name: "Oats" }, new AbortController().signal)).resolves.toEqual(value);
  expect(mockPush).not.toHaveBeenCalled();
  candidateLookup.onCompare(catalog);
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/find-product", params: { productId: "canonical-oats" } });
  candidateLookup.onCompare(observation);
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/compare/[id]", params: { id: observation.observationId, source: "shared" } });
});

test("passes only an opaque intent through navigation and hides its photo from another owner", async () => {
  mockScanParams = { mode: "lookup" };
  const capture = await render(<ScanScreen />);
  const { onCompare, onRetake } = mockProductLookup.mock.lastCall?.[0];
  const asset = { uri: "file:///private.jpg", width: 200, height: 200, mimeType: "image/jpeg" };
  const draft = { id: "draft", capturedAt: "2026-11-20T11:00:00Z", original: asset, selected: asset };
  const product = { id: "catalog", name: "Oats" };
  onCompare("012345678905", product, draft);
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/find-product", params: {
    barcode: "012345678905", photoSource: draft.id,
  } });

  mockScanParams = { barcode: "012345678905", photoSource: draft.id };
  mockEnrolled = true;
  const wrongOwner = await render(<FindProductScreen />);
  expect(await screen.findByText("Barcode lookup")).toBeOnTheScreen();
  expect(mockBarcodeProps.mock.lastCall?.[0].photoSource).toBeUndefined();
  await wrongOwner.unmount();

  mockEnrolled = false;
  const comparison = await render(<FindProductScreen />);
  expect(await screen.findByText("Barcode lookup")).toBeOnTheScreen();
  expect(mockBarcodeProps.mock.lastCall?.[0].photoSource).toEqual({ productId: product.id, owner: null, source: {
    original: asset, selected: asset, capturedAt: draft.capturedAt,
  } });
  await comparison.unmount();
  expect(productPhotoPriceSources.has(draft.id)).toBe(false);
  onCompare("012345678905", product, draft);
  onRetake();
  expect(productPhotoPriceSources.has(draft.id)).toBe(false);
  await capture.unmount();
});

test("Home opens barcode lookup with no selected shop and keeps label scan available", async () => {
  await render(<HomeScreen />);
  await fireEvent.press(screen.getByRole("button", { name: "Find product by barcode" }));
  expect(mockPush).toHaveBeenLastCalledWith("/find-product");
  await screen.rerender(<FindProductScreen />);
  expect(await screen.findByText("Barcode lookup")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Add a shop" })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Scan label" }));
  expect(mockReplace).toHaveBeenLastCalledWith("/scan");
});

test("passes an existing selected shop to barcode lookup without changing it", async () => {
  const shop = { id: "lidl-1", nickname: "Tandem Centre Lidl" };
  jest.mocked(loadSavedShops).mockResolvedValue({ shops: [shop], currentShop: shop });
  await render(<FindProductScreen />);
  expect(await screen.findByText("Barcode lookup · Tandem Centre Lidl")).toBeOnTheScreen();
  expect(testShopRepository.selectShop).not.toHaveBeenCalled();
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

test("exposes device enrollment only in configured Android Field builds without removing ChatGPT", async () => {
  const platform = jest.replaceProperty(Platform, "OS", "android");
  mockExtra.fieldTest = true;
  try {
    await render(<HomeScreen />);
    expect(screen.queryByRole("button", { name: /cheapo access/i })).not.toBeOnTheScreen();
    mockExtra.cheapoApiOrigin = "https://cheapo.example";
    await screen.rerender(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: /cheapo access/i }));
    expect(mockPush).toHaveBeenLastCalledWith("/cheapo-access");
    await fireEvent.press(screen.getByRole("button", { name: /chatgpt/i }));
    expect(mockPush).toHaveBeenLastCalledWith("/direct-auth");
  } finally {
    platform.restore();
  }
});
