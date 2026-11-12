import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShopPicker } from "@/component/shop/shop-picker";

const shops = [
  { id: "morden", nickname: "Morden Lidl", name: "Lidl", address: "Morden" },
  { id: "sainsburys", name: "Sainsbury's" },
];

test("suggests a shop without selecting until the shopper taps it", async () => {
  const onSelect = jest.fn();
  await render(
    <ShopPicker shops={shops} onSelect={onSelect} onAddShop={jest.fn()} onCancel={jest.fn()} />,
  );
  const search = screen.getByLabelText("Search saved shops");

  await fireEvent.changeText(search, "morde");
  expect(screen.getByRole("button", { name: /Morden Lidl/ })).toBeOnTheScreen();
  expect(onSelect).not.toHaveBeenCalled();

  await fireEvent.changeText(search, "synsbury");
  expect(screen.queryByRole("button", { name: /Morden Lidl/ })).not.toBeOnTheScreen();
  expect(onSelect).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole("button", { name: "Sainsbury's" }));
  expect(onSelect).toHaveBeenCalledWith(shops[1]);
});

test("keeps Add a shop available for an unrelated query", async () => {
  const onSelect = jest.fn();
  const onAddShop = jest.fn();
  await render(<ShopPicker shops={shops} onSelect={onSelect} onAddShop={onAddShop} onCancel={jest.fn()} />);

  await fireEvent.changeText(screen.getByLabelText("Search saved shops"), "butcher");

  expect(screen.getByText("No matching shops")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Add a shop" }));
  expect(onAddShop).toHaveBeenCalledTimes(1);
  expect(onSelect).not.toHaveBeenCalled();
});

test("marks the current shop and supports cancellation", async () => {
  const onCancel = jest.fn();
  await render(
    <ShopPicker
      shops={shops}
      selectedShopId="morden"
      onSelect={jest.fn()}
      onAddShop={jest.fn()}
      onCancel={onCancel}
    />,
  );

  expect(screen.getByRole("button", { name: /Morden Lidl/, selected: true })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("distinguishes loading, load failure, and an empty shop list", async () => {
  const props = { shops: [], onSelect: jest.fn(), onAddShop: jest.fn(), onCancel: jest.fn() };
  await render(<ShopPicker {...props} isLoading />);
  expect(screen.getByText("Loading saved shops…")).toBeOnTheScreen();

  await screen.rerender(<ShopPicker {...props} error="Could not load saved shops." />);
  expect(screen.getByRole("alert", { name: "Could not load saved shops." })).toBeOnTheScreen();

  await screen.rerender(<ShopPicker {...props} />);
  expect(screen.getByText("No saved shops yet")).toBeOnTheScreen();
});
