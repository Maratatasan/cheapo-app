import { fireEvent, render, screen, within } from "@testing-library/react-native";
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

test("sorts by unit price, keeps equal prices stable, and puts missing unit prices last", async () => {
  const supplied = Object.freeze([
    { id: "unknown", shop: "Unknown unit price shop", price: 0.5, currency: "GBP" },
    { id: "higher", shop: "Higher unit price shop", price: 1, currency: "GBP", unit_price: { amount: 2, unit: "kg" } },
    { id: "tie1", shop: "First equal unit price shop", price: 4, currency: "GBP", unit_price: { amount: 1, unit: "kg" } },
    { id: "tie2", shop: "Second equal unit price shop", price: 3, currency: "GBP", unit_price: { amount: 1, unit: "kg" } },
  ] as const);

  await render(<ShopComparison product={product} comparisons={supplied} />);

  expect(screen.getAllByText(/unit price shop$/).map((label) => label.props.children)).toEqual([
    "First equal unit price shop",
    "Second equal unit price shop",
    "Higher unit price shop",
    "Unknown unit price shop",
  ]);
});

test("shows separate rankings for different units", async () => {
  await render(
    <ShopComparison
      product={product}
      comparisons={[
        { id: "kg-higher", shop: "Higher kg shop", price: 4, currency: "GBP", unit_price: { amount: 2, unit: "kg" } },
        { id: "item", shop: "Per item shop", price: 0.25, currency: "GBP", unit_price: { amount: 0.25, unit: "item" } },
        { id: "kg-lower", shop: "Lower kg shop", price: 2, currency: "GBP", unit_price: { amount: 1, unit: "kg" } },
      ]}
    />,
  );

  expect(screen.getByRole("header", { name: "Per kg" })).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Per item" })).toBeOnTheScreen();
  expect(screen.getAllByText(/shop$/).map((label) => label.props.children)).toEqual([
    "Lower kg shop", "Higher kg shop", "Per item shop",
  ]);
});


test("only marks the actual cheapest eligible price, including the reference", async () => {
  const reference = { id: "anchor", shop: "Reference shop", productType: "Fresh potatoes", price: 2.2, currency: "GBP", unit_price: { amount: 1.1, unit: "kg" } };
  const candidate = { ...comparisons[0], productType: "Fresh potatoes" };
  await render(<ShopComparison product={product} reference={reference} comparisons={[candidate]} />);
  const first = screen.getByText("Lowest unit price");
  expect(within(first.parent!).getByText("£1.10 / kg")).toBeOnTheScreen();
  await screen.rerender(<ShopComparison product={product} reference={{ ...reference, unit_price: { amount: 1.24, unit: "kg" } }} comparisons={[candidate]} />);
  expect(screen.getAllByText("Lowest unit price")).toHaveLength(2);
});
