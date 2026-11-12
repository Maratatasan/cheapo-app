import { fireEvent, render, screen } from "@testing-library/react-native";
import { ObservationCard } from "@/component/results/observation-card";
import { ShopCard } from "@/component/results/shop-card";
import { sampleObservations } from "@/data/sample-observations";
import type { Observation } from "@/data/observation";

const example = sampleObservations[0];

const names: { shop: Observation["shop"]; expected: string }[] = [
  { shop: { id: "tandem", name: "Lidl", nickname: "Tandem Centre Lidl" }, expected: "Tandem Centre Lidl" },
  { shop: { id: "name-only", name: "Lidl" }, expected: "Lidl" },
  { shop: "Aldi", expected: "Aldi" },
];

test.each(names)("shows $expected on the observation and shop cards", async ({ shop, expected }) => {
  const onShop = jest.fn();
  const onSelect = jest.fn();
  await render(
    <>
      <ObservationCard item={{ ...example, shop }} onShop={onShop} />
      <ShopCard {...example} shop={shop} onSelect={onSelect} />
    </>,
  );

  expect(screen.getByText(expected.toUpperCase())).toBeOnTheScreen();
  expect(screen.getByText(expected)).toBeOnTheScreen();
  expect(screen.getByLabelText(`Observation: ${expected}, £1.49`)).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: `See ${expected} on map` }));
  await fireEvent.press(screen.getByRole("button", { name: `Select ${expected}` }));
  expect(onShop).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test("shows pack and unit prices independently on a display-only comparison card", async () => {
  await render(
    <ShopCard
      shop="Tandem Centre Lidl"
      price={2.5}
      currency="GBP"
      unit_price={{ amount: 1.25, unit: "kg" }}
    />,
  );

  expect(screen.getByText("Pack price")).toBeOnTheScreen();
  expect(screen.getByText("£2.50")).toBeOnTheScreen();
  expect(screen.getByText("£1.25 / kg")).toBeOnTheScreen();
  expect(screen.queryByRole("button")).not.toBeOnTheScreen();
});

test("makes missing unit prices explicit for older cards", async () => {
  await render(<ShopCard shop="Aldi" price={1.39} currency="GBP" onSelect={jest.fn()} />);

  expect(screen.getByText("£1.39")).toBeOnTheScreen();
  expect(screen.getByText("Unit price unavailable")).toBeOnTheScreen();
});
