import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn } from "storybook/test";
import { ShopPicker } from "../component/shop/shop-picker";

const shops = [
  { id: "morden", nickname: "Morden Lidl", name: "Lidl", address: "Morden" },
  { id: "sainsburys", name: "Sainsbury's" },
];
const meta = {
  title: "Shops/Shop picker",
  component: ShopPicker,
  tags: ["autodocs"],
  args: { shops, onSelect: fn(), onAddShop: fn(), onCancel: fn() },
} satisfies Meta<typeof ShopPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SavedShops: Story = {};
export const CurrentShop: Story = { args: { selectedShopId: "morden" } };
export const Empty: Story = { args: { shops: [] } };
export const Loading: Story = { args: { isLoading: true } };
export const Error: Story = { args: { error: "Could not load saved shops." } };
export const ConfirmSelection: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await expect(args.onSelect).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Sainsbury's" }));
    await expect(args.onSelect).toHaveBeenCalledWith(shops[1]);
  },
};

export const ManageShops: Story = { args: { onEditShop: fn(), selectedShopId: "morden" } };
