/// <reference types="vite/client" />

import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn } from "storybook/test";
import { ShopComparison, type ShopComparisonProps } from "../component/results/shop-comparison";

const localPhoto = import.meta.env.DEV
  ? import.meta.env.VITE_COMPARISON_SAMPLE_PHOTO
  : undefined;

const product = {
  name: "Albert Bartlett Rooster Potatoes",
  pack: "2 kg bag",
  photo: localPhoto ? { uri: localPhoto } : undefined,
};

const sampleShops = [
  ["colliers-sainsburys", "Sainsbury’s", "Colliers Wood Sainsbury’s", 2.7],
  ["morden-sainsburys", "Sainsbury’s", "Morden Sainsbury’s", 2.84],
  ["tandem-lidl", "Lidl", "Tandem Centre Lidl", 2.48],
  ["colliers-aldi", "Aldi", "Colliers Wood Aldi", 2.54],
  ["sutton-lidl", "Lidl", "Sutton Lidl", 2.62],
  ["sutton-sainsburys", "Sainsbury’s", "Sutton Sainsbury’s", 2.94],
] as const;

const samplePrices: ShopComparisonProps["comparisons"] = sampleShops.map(([id, name, nickname, price]) => ({
  id,
  shop: { id, name, nickname },
  price,
  currency: "GBP",
  unit_price: { amount: price / 2, unit: "kg" },
}));

const meta = {
  title: "Screens/Shop comparison",
  component: ShopComparison,
  args: { product, comparisons: samplePrices, sample: true },
} satisfies Meta<typeof ShopComparison>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Results: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText(/£[\d.]+ \/ kg/).map((price) => price.textContent)).toEqual([
      "£1.24 / kg", "£1.27 / kg", "£1.31 / kg", "£1.35 / kg", "£1.42 / kg", "£1.47 / kg",
    ]);
  },
};
export const Loading: Story = { args: { state: "loading" } };
export const NoSavedPrices: Story = { args: { comparisons: [] } };
export const MissingPhotoAndUnitPrice: Story = {
  args: {
    product: { ...product, photo: undefined },
    comparisons: [{ ...samplePrices[0], unit_price: null }],
  },
};
export const ErrorWithRetry: Story = {
  args: { state: "error", onRetry: fn() },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.onRetry).toHaveBeenCalledTimes(1);
  },
};
