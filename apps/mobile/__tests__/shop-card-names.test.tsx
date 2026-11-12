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
