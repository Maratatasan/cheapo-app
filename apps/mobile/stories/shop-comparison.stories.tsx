/// <reference types="vite/client" />

import { useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PhotoReview } from "../component/photo-review";
import { observationShopLabel } from "../data/observation";
import { emptyReview, type ManualReview } from "../data/photo-review";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fireEvent, fn } from "storybook/test";
import { ShopComparison, type ComparisonRow, type ShopComparisonProps } from "../component/results/shop-comparison";

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
    await expect(canvas.getAllByLabelText(/£[\d.]+ \/ kg/).map((price) => price.getAttribute("aria-label"))).toEqual([
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
    await expect(canvas.getByLabelText("£1.40 / kg")).toBeVisible();
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


function EditComparison({ saveFails = false }: { saveFails?: boolean }) {
  const [reference, setReference] = useState<ComparisonRow>(filterReference);
  const [prices, setPrices] = useState(filteredPrices);
  const [editing, setEditing] = useState<{ id: string; review: ManualReview }>();
  const [error, setError] = useState<string>();

  function startEdit(id: string) {
    const row = id === reference.id ? reference : prices.find(price => price.id === id);
    if (!row) return;
    setError(undefined);
    setEditing({ id, review: {
      ...emptyReview(observationShopLabel(row.shop)), productName: row.product ?? product.name,
      price: String(row.price ?? ""), currency: row.currency ?? "", unitPrice: String(row.unit_price?.amount ?? ""),
      unit: row.unit_price?.unit ?? "", productType: row.productType, variety: row.variety, brand: row.brand,
    } });
  }

  function save() {
    if (!editing) return;
    if (saveFails) { setError("Could not save changes. Your edits are still here. Try again."); return; }
    const { id, review } = editing;
    const changes = {
      product: review.productName, price: Number(review.price), currency: review.currency,
      unit_price: review.unitPrice ? { amount: Number(review.unitPrice), unit: review.unit } : null,
      productType: review.productType, variety: review.variety, brand: review.brand,
    };
    if (id === reference.id) setReference({ ...reference, ...changes });
    else setPrices(prices.map(row => row.id === id ? { ...row, ...changes } : row));
    setEditing(undefined);
  }

  return (
    <>
      <View style={editing ? { display: "none" } : undefined}>
        <ShopComparison product={{ ...product, name: reference.product ?? product.name }} sample reference={reference}
          comparisons={prices} onEdit={startEdit} />
      </View>
      {editing ? (
        <View style={{ height: 680 }}>
          <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 600, height: 680 }, insets: { top: 0, left: 0, bottom: 0, right: 0 } }}>
            <PhotoReview photo={localPhoto ? { uri: localPhoto, width: 600, height: 600, mimeType: 'image/jpeg' } : undefined}
              review={editing.review} selectedShopName={editing.review.shop} saved={false} busy={false}
              onReviewChange={review => setEditing({ ...editing, review })} onSave={save} onCancel={() => setEditing(undefined)} saveError={error} />
          </SafeAreaProvider>
        </View>
      ) : null}
    </>
  );
}

const editOffer = "Edit Maris Piper potatoes 2 kg at Tandem Centre Lidl";
export const EditSavedComparison: Story = {
  render: () => <EditComparison />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("checkbox", { name: "Same brand" }));
    await userEvent.click(canvas.getByRole("button", { name: editOffer }));
    await expect(canvas.getByLabelText("Unit price (optional)")).toHaveValue("0.124");
    await expect(canvas.getByLabelText("Unit (for example kg or litre)")).toHaveValue("100g");
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(canvas.getByLabelText("£1.24 / kg")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: editOffer }));
    const update = async (name: string, value: string) => {
      const field = canvas.getByLabelText(name);
      await fireEvent.change(field, { target: { value } });
      await expect(field).toHaveValue(value);
    };
    await update("Pack price", "3.50");
    await update("Unit price (optional)", "1.75");
    await update("Unit (for example kg or litre)", "kg");
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
    await expect(canvas.getByRole("checkbox", { name: "Same brand" })).toBeChecked();
    await expect(canvas.getAllByLabelText(/£[\d.]+ \/ kg/).map(price => price.getAttribute("aria-label"))).toEqual([
      "£1.40 / kg", "£1.35 / kg", "£1.42 / kg", "£1.75 / kg",
    ]);
  },
};

export const EditSaveError: Story = {
  render: () => <EditComparison saveFails />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: editOffer }));
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Your edits are still here");
    await expect(canvas.getByLabelText("Unit price (optional)")).toHaveValue("0.124");
  },
};
