import React from "react";
import { render, screen, userEvent } from "@testing-library/react-native";
import { ResultsBrowser } from "../component/results/results-browser";
import { sampleObservations } from "../data/sample-observations";

jest.useFakeTimers();
it("keeps cheapest and nearest as separate choices", async () => {
  const user = userEvent.setup();
  await render(<ResultsBrowser observations={sampleObservations} />);
  expect(screen.getAllByLabelText(/^Observation:/)[0]).toHaveAccessibleName(
    "Observation: Aldi, £1.39",
  );
  await user.press(screen.getByRole("button", { name: "Nearest" }));
  expect(screen.getAllByLabelText(/^Observation:/)[0]).toHaveAccessibleName(
    "Observation: Lidl, £1.49",
  );
});
it("offers a useful empty state when a search has no matches", async () => {
  const user = userEvent.setup();
  await render(<ResultsBrowser observations={sampleObservations} />);
  await user.type(
    screen.getByLabelText("Search sample observations"),
    "not a product",
  );
  expect(screen.getByText("No observations yet")).toBeOnTheScreen();
  expect(screen.queryAllByLabelText(/^Observation:/)).toHaveLength(0);
});
it("shows a review state instead of a made-up unit price for unclear packs", async () => {
  await render(
    <ResultsBrowser
      observations={sampleObservations.filter(
        (item) => item.id === "morrisons",
      )}
    />,
  );
  expect(screen.getByText("Price to review")).toBeOnTheScreen();
  expect(screen.getByText("Unit price unavailable")).toBeOnTheScreen();
  expect(screen.getByText("Draft · review needed")).toBeOnTheScreen();
});

it("rounds a half-penny unit price to the nearest penny", async () => {
  await render(
    <ResultsBrowser
      observations={sampleObservations.filter((item) => item.id === "aldi")}
    />,
  );
  expect(screen.getByText("£0.70 / litre")).toBeOnTheScreen();
});
it("preserves a supplied weight unit independently of the pack price", async () => {
  await render(
    <ResultsBrowser
      observations={[
        {
          ...sampleObservations[0],
          product: "Potatoes",
          pack: "2 kg",
          price: 2.5,
          unit_price: { amount: 1.25, unit: "kg" },
        },
      ]}
    />,
  );
  expect(screen.getByText("£2.50")).toBeOnTheScreen();
  expect(screen.getByText("£1.25 / kg")).toBeOnTheScreen();
});
it("offers a retry action when observations cannot load", async () => {
  const user = userEvent.setup();
  const retry = jest.fn();
  await render(
    <ResultsBrowser observations={[]} state="error" onRetry={retry} />,
  );
  await user.press(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByLabelText("Search sample observations"),
  ).not.toBeOnTheScreen();
});
it("shows loading feedback before comparison controls are available", async () => {
  await render(<ResultsBrowser observations={[]} state="loading" />);
  expect(screen.getByText("Loading observations")).toBeOnTheScreen();
  expect(
    screen.queryByRole("button", { name: "Cheapest" }),
  ).not.toBeOnTheScreen();
});
