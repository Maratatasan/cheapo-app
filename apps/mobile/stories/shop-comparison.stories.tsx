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

const freshPotatoes = { productType: "Fresh potatoes", variety: "Rooster", brand: "Brand A" };
const filteredPrices: ShopComparisonProps["comparisons"] = [
  { ...samplePrices[0], ...freshPotatoes, product: "Rooster potatoes 2 kg" },
  { ...samplePrices[1], ...freshPotatoes, product: "Rooster potatoes 1 kg", price: 1.42 },
  { ...samplePrices[2], ...freshPotatoes, variety: "Maris Piper", product: "Maris Piper potatoes 2 kg", unit_price: { amount: 0.124, unit: "100g" } },
  { ...samplePrices[3], ...freshPotatoes, brand: "Brand B", product: "Brand B Rooster potatoes 2 kg" },
  { ...samplePrices[4], ...freshPotatoes, brand: "Brand C", variety: "Maris Piper", product: "Brand C Maris Piper potatoes 2 kg" },
  { ...samplePrices[5], ...freshPotatoes, productType: "Frozen chips", product: "Frozen chips 2 kg" },
];
const filterReference = {
  ...freshPotatoes, id: "reference", shop: "Reference shop", price: 2.8, currency: "GBP",
  unit_price: { amount: 0.14, unit: "100g" },
};

export const ProductFilters: Story = {
  args: {
    product: { ...product, name: "Rooster potatoes" },
    reference: filterReference,
    comparisons: filteredPrices,
  },
  play: async ({ canvas, userEvent }) => {
    const variety = canvas.getByRole("checkbox", { name: "Same variety" });
    const brand = canvas.getByRole("checkbox", { name: "Same brand" });
    const sameBrandOnly = "Maris Piper potatoes 2 kg";
    const sameVarietyOnly = "Brand B Rooster potatoes 2 kg";
    await expect(canvas.getByText("£1.40 / kg")).toBeVisible();
    await expect(canvas.getByText(sameBrandOnly)).toBeVisible();
    await expect(canvas.getByText(sameVarietyOnly)).toBeVisible();
    await expect(canvas.queryByText("Frozen chips 2 kg")).not.toBeInTheDocument();
    await userEvent.click(variety);
    await expect(variety).toBeChecked();
    await expect(canvas.queryByText(sameBrandOnly)).not.toBeInTheDocument();
    await expect(canvas.getByText(sameVarietyOnly)).toBeVisible();
    await userEvent.click(brand);
    await expect(brand).toBeChecked();
    await expect(canvas.queryByText(sameVarietyOnly)).not.toBeInTheDocument();
    await expect(canvas.getByText("Rooster potatoes 1 kg")).toBeVisible();
    await userEvent.click(variety);
    await expect(variety).not.toBeChecked();
    await expect(canvas.getByText(sameBrandOnly)).toBeVisible();
    await expect(canvas.queryByText(sameVarietyOnly)).not.toBeInTheDocument();
    await userEvent.click(brand);
    await expect(brand).not.toBeChecked();
    await expect(canvas.getByText(sameVarietyOnly)).toBeVisible();
  },
};

export const MissingVariety: Story = {
  args: { ...ProductFilters.args, reference: { ...filterReference, variety: undefined } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("checkbox", { name: "Same variety" }));
    await expect(canvas.getByText("More product details needed")).toBeVisible();
  },
};
