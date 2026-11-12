import { fireEvent, render, screen } from "@testing-library/react-native";
import { ShopComparison, type ShopComparisonProps } from "@/component/results/shop-comparison";

const product = { name: "Rooster Potatoes", pack: "2 kg bag" };
const comparisons: ShopComparisonProps["comparisons"] = [
  {
    id: "tandem",
    shop: { id: "tandem", name: "Lidl", nickname: "Tandem Centre Lidl" },
    price: 2.48,
    currency: "GBP",
    unit_price: { amount: 1.24, unit: "kg" },
  },
];

test("shows the scan photo, product, pack, and known comparison prices", async () => {
  await render(
    <ShopComparison
      product={{ ...product, photo: { uri: "file:///potatoes.jpg" } }}
      comparisons={comparisons}
      sample
    />,
  );

  expect(screen.getByLabelText("Scan photo for Rooster Potatoes")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Rooster Potatoes" })).toBeOnTheScreen();
  expect(screen.getByText("2 kg bag")).toBeOnTheScreen();
  expect(screen.getByText("Tandem Centre Lidl")).toBeOnTheScreen();
  expect(screen.getByText("£2.48")).toBeOnTheScreen();
  expect(screen.getByText("£1.24 / kg")).toBeOnTheScreen();
  expect(screen.getByText("SAMPLE DATA · FOR EXPLORING ONLY")).toBeOnTheScreen();
});

test("distinguishes loading from an empty result and preserves product details", async () => {
  await render(<ShopComparison product={product} comparisons={[]} state="loading" />);
  expect(screen.getByText("Loading shop prices")).toBeOnTheScreen();
  expect(screen.queryByText("No saved prices yet")).not.toBeOnTheScreen();

  await screen.rerender(<ShopComparison product={product} comparisons={[]} />);
  expect(screen.getByText("No saved prices yet")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Rooster Potatoes" })).toBeOnTheScreen();
});

test("shows missing photo and unit price while keeping the known pack price", async () => {
  await render(
    <ShopComparison product={product} comparisons={[{ ...comparisons[0], unit_price: null }]} />,
  );

  expect(screen.getByText("Photo unavailable")).toBeOnTheScreen();
  expect(screen.getByText("£2.48")).toBeOnTheScreen();
  expect(screen.getByText("Unit price unavailable")).toBeOnTheScreen();
});

test("shows an error and delegates retry to the supplied callback", async () => {
  const retry = jest.fn();
  await render(<ShopComparison product={product} comparisons={comparisons} state="error" onRetry={retry} />);

  expect(screen.getByText("Couldn’t load shop prices")).toBeOnTheScreen();
  expect(screen.queryByText("Tandem Centre Lidl")).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
