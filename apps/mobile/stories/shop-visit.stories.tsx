import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fireEvent } from "storybook/test";
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

function ShopVisitPreview({ startInPicker = false }: { startInPicker?: boolean }) {
  const [state, setState] = useState<SavedShopState>({ shops: sampleShops, currentShop: startInPicker ? sampleShops[0] : undefined });
  const [screen, setScreen] = useState<"home" | "choose" | "choose-for-scan" | "scan">(startInPicker ? "choose" : "home");
  const nextId = useRef(0);
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
              const shop = { ...values, id: values.id ?? `sample-${++nextId.current}` };
              return {
                shops: [...state.shops, shop],
                currentShop: options?.select ? shop : state.currentShop,
              };
            },
          }}
          management={screen === "choose" ? {
            updateShop: async (id, values) => {
              const previous = state.shops.find(shop => shop.id === id);
              if (!previous) throw Error("That shop is no longer saved.");
              const edited = { ...previous, ...values };
              return {
                shops: state.shops.map(shop => shop.id === id ? edited : shop),
                currentShop: state.currentShop?.id === id ? edited : state.currentShop,
              };
            },
            removeShop: async (id) => ({
              shops: state.shops.filter(shop => shop.id !== id),
              currentShop: state.currentShop?.id === id ? undefined : state.currentShop,
            }),
            onChanged: setState,
          } : undefined}
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


export const ManageSavedShops: Story = { args: { startInPicker: true } };

export const EditAndRemove: Story = {
  args: { startInPicker: true },
  play: async ({ canvas, userEvent }) => {
    const click = (name: string) => userEvent.click(canvas.getByRole("button", { name }));
    await click("Edit Colliers Wood Sainsbury’s");
    const address = canvas.getByRole("textbox", { name: "Address (optional)" });
    await fireEvent.change(address, { target: { value: "12 Example Road" } });
    await click("Save changes");
    await expect(await canvas.findByText(/12 Example Road/)).toBeVisible();
    await click("Edit Colliers Wood Sainsbury’s");
    await click("Remove shop");
    await expect(canvas.getByRole("heading", { name: "Remove Colliers Wood Sainsbury’s?" })).toBeVisible();
    await expect(canvas.getByText(/Previous prices and photos will be kept/)).toBeVisible();
    await click("Cancel");
    await expect(canvas.getByRole("textbox", { name: "Address (optional)" })).toHaveValue("12 Example Road");
    await click("Remove shop");
    await click("Remove shop");
    await expect(canvas.queryByRole("button", { name: "Edit Colliers Wood Sainsbury’s" })).not.toBeInTheDocument();
    await click("Cancel");
    await expect(canvas.getByRole("button", { name: "Select current shop" })).toBeVisible();
  },
};

export const CreateShop: Story = {
  args: { startInPicker: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Add a shop" }));
    await fireEvent.change(canvas.getByRole("textbox", { name: "Nickname" }), { target: { value: "Example Market" } });
    await userEvent.click(canvas.getByRole("button", { name: "Save shop" }));
    await expect(await canvas.findByText("You're at: Example Market")).toBeVisible();
  },
};
