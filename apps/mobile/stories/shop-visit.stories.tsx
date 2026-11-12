import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect } from "storybook/test";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { shopDisplayName } from "@cheapo/domain/names";

import { ui } from "../component/results/theme";
import { ShopChooser } from "../component/shop/shop-chooser";
import { ShopHome } from "../component/shop/shop-home";
import type { SavedShopState } from "../data/local-shops";

const sampleShops = [
  { id: "colliers-sainsburys", name: "Sainsbury’s", nickname: "Colliers Wood Sainsbury’s" },
  { id: "morden-sainsburys", name: "Sainsbury’s", nickname: "Morden Sainsbury’s" },
  { id: "tandem-lidl", name: "Lidl", nickname: "Tandem Centre Lidl" },
  { id: "colliers-aldi", name: "Aldi", nickname: "Colliers Wood Aldi" },
  { id: "sutton-lidl", name: "Lidl", nickname: "Sutton Lidl" },
  { id: "sutton-sainsburys", name: "Sainsbury’s", nickname: "Sutton Sainsbury’s" },
];

function ShopVisitPreview() {
  const [state, setState] = useState<SavedShopState>({ shops: sampleShops });
  const [screen, setScreen] = useState<"home" | "choose" | "choose-for-scan" | "scan">("home");
  const shopLabel = state.currentShop && shopDisplayName(state.currentShop);

  return (
    <View style={styles.preview}>
      {screen === "choose" || screen === "choose-for-scan" ? (
        <ShopChooser
          state={state}
          actions={{
            selectShop: async (id) => {
              const currentShop = state.shops.find((shop) => shop.id === id);
              if (!currentShop) throw new Error("That shop is no longer saved.");
              return { ...state, currentShop };
            },
            saveShop: async (values, options) => {
              const shop = { ...values, id: values.id ?? `sample-${state.shops.length + 1}` };
              return {
                shops: [...state.shops, shop],
                currentShop: options?.select ? shop : state.currentShop,
              };
            },
          }}
          onSelected={(next) => {
            setState(next);
            setScreen(screen === "choose-for-scan" ? "scan" : "home");
          }}
          onCancel={() => setScreen("home")}
        />
      ) : screen === "scan" ? (
        <View style={ui.content}>
          <Text accessibilityRole="header" style={ui.title}>Scan handoff preview</Text>
          <Text style={ui.body}>A scan would use {shopLabel}.</Text>
          <Pressable accessibilityRole="button" onPress={() => setScreen("home")} style={ui.button}>
            <Text style={ui.buttonText}>Back to Home</Text>
          </Pressable>
        </View>
      ) : (
        <ShopHome
          currentShop={state.currentShop}
          onChooseShop={() => setScreen("choose")}
          onScan={() => setScreen(state.currentShop ? "scan" : "choose-for-scan")}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { height: 540, width: "100%" },
});

const meta = {
  title: "Screens/Current shop visit",
  component: ShopVisitPreview,
} satisfies Meta<typeof ShopVisitPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};

export const FirstScan: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Scan item" }));
    await expect(canvas.getByRole("heading", { name: "Select current shop" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Tandem Centre Lidl/ }));
    await expect(await canvas.findByText("A scan would use Tandem Centre Lidl.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Back to Home" }));
    await expect(canvas.getByText("You're at: Tandem Centre Lidl")).toBeVisible();
  },
};
