import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { fn } from "storybook/test";
import { ShopRemovalConfirmation } from "../component/shop/shop-removal-confirmation";

const meta = {
  title: "Shops/Remove shop confirmation",
  component: ShopRemovalConfirmation,
  args: { name: "Example Market", busy: false, isCurrent: false, onConfirm: fn(), onCancel: fn() },
} satisfies Meta<typeof ShopRemovalConfirmation>;
export default meta;

type Story = StoryObj<typeof meta>;
export const CurrentShop: Story = { args: { isCurrent: true } };
export const Failed: Story = { args: { error: "Could not save your shop changes. Try again." } };
