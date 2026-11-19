import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect } from "storybook/test";
import { StyleSheet, Text, View } from "react-native";
import { ShopHome } from "@/component/shop/shop-home";
import { CameraActionButton } from "@/component/camera-actions";
import { CurrentShopPrice } from "@/component/results/current-shop-price";
import { ShopComparison, type ComparisonRow } from "@/component/results/shop-comparison";
import { DisplayState } from "@/component/results/display-state";
import { AddBarcodeProduct } from "@/component/add-barcode-product";
import { ui } from "@/component/results/theme";

const product = { name: "Example Basmati Rice", productType: "Dry rice", brand: "Example", variety: "Basmati" };
const selectedShop = { id: "current", name: "Example Market" };
const barcode = "04006381333931";
const comparisons: ComparisonRow[] = [
  { id: "oak", shop: "Oak Market", product: product.name, productType: product.productType,
    price: 2.65, currency: "GBP", unit_price: { amount: 5.30, unit: "kg" }, capturedOn: "2026-11-18" },
  { id: "river", shop: "River Market", product: product.name, productType: product.productType,
    price: 2.29, currency: "GBP", unit_price: { amount: 4.58, unit: "kg" }, capturedOn: "2026-11-19" },
];

function HomeBarcodePreview({ hasShop = false }: { hasShop?: boolean }) {
  const [screen, setScreen] = useState<"home" | "scanner" | "known" | "unknown" | "add">("home");
  return <View style={styles.preview}>
    {screen === "home" ? (
      <ShopHome currentShop={hasShop ? selectedShop : undefined} onScan={() => {}}
        onChooseShop={() => {}} onFindBarcode={() => setScreen("scanner")}
        onOpenSaved={() => {}} onExploreSamples={() => {}} />
    ) : screen === "add" ? (
      <AddBarcodeProduct barcode={barcode} busy={false} onSave={() => {}} onCancel={() => setScreen("scanner")} />
    ) : <View style={ui.content}>
      {screen === "scanner" ? <>
        <Text accessibilityRole="header" style={ui.title}>Find product by barcode</Text>
        <Text style={ui.body}>Point the camera at the product barcode.</Text>
        <CameraActionButton label="Read sample known barcode" onPress={() => setScreen("known")} />
        <CameraActionButton label="Read sample unknown barcode" onPress={() => setScreen("unknown")} />
      </> : screen === "known" ? <>
        {hasShop ? <CurrentShopPrice shop={selectedShop.name} onRecord={() => {}} /> : null}
        <ShopComparison product={{ name: product.name, pack: "500 g" }} catalogProduct={product} comparisons={comparisons} />
      </> : <DisplayState kind="empty" title="Product not found" description="This barcode is not in your saved products."
        actionLabel="Add product" onAction={() => setScreen("add")} />}
    </View>}
  </View>;
}

const styles = StyleSheet.create({ preview: { width: 360, maxWidth: "100%", minHeight: 470 } });
const meta = { title: "Screens/Home barcode", component: HomeBarcodePreview } satisfies Meta<typeof HomeBarcodePreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const HomeActions: Story = { args: { hasShop: true } };

export const KnownWithoutShop: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Find product by barcode" }));
    await expect(canvas.getByRole("heading", { name: "Find product by barcode" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Select current shop" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Read sample known barcode" }));
    await expect(canvas.getByRole("heading", { name: product.name })).toBeVisible();
    await expect(canvas.getByText("River Market")).toBeVisible();
    await expect(canvas.getByText("Oak Market")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Add product" })).not.toBeInTheDocument();
  },
};

export const UnknownGoesToAddProduct: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Find product by barcode" }));
    await userEvent.click(canvas.getByRole("button", { name: "Read sample unknown barcode" }));
    await userEvent.click(canvas.getByRole("button", { name: "Add product" }));
    await expect(canvas.getByText(`Barcode ${barcode}`)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Save product" })).toBeVisible();
  },
};
