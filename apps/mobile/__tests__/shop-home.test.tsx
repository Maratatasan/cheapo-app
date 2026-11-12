import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShopHome } from "@/component/shop/shop-home";

test("shows the preferred current shop and emits Change shop and Scan item", async () => {
  const onChooseShop = jest.fn();
  const onScan = jest.fn();
  await render(
    <ShopHome
      currentShop={{ id: "tandem", name: "Lidl", nickname: "Tandem Centre Lidl" }}
      onChooseShop={onChooseShop}
      onScan={onScan}
    />,
  );

  expect(screen.getByText("You're at: Tandem Centre Lidl")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Change shop" }));
  await fireEvent.press(screen.getByRole("button", { name: "Scan item" }));
  expect(onChooseShop).toHaveBeenCalledTimes(1);
  expect(onScan).toHaveBeenCalledTimes(1);
});

test("offers current shop selection and scanning before a shop is selected", async () => {
  const onChooseShop = jest.fn();
  await render(<ShopHome onChooseShop={onChooseShop} onScan={jest.fn()} />);

  expect(screen.queryByText(/You're at/)).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Scan item" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Select current shop" }));
  expect(onChooseShop).toHaveBeenCalledTimes(1);
});
