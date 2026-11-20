import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn } from "storybook/test";
import { ShopSyncFeedback } from "../component/shop/shop-chooser";
import { ShopHome } from "../component/shop/shop-home";

const meta = {
  title: "Shops/Home",
  component: ShopHome,
  tags: ["autodocs"],
  args: { onChooseShop: fn(), onScan: fn(), onExploreSamples: fn() },
} satisfies Meta<typeof ShopHome>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoCurrentShop: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Select current shop" }));
    await expect(args.onChooseShop).toHaveBeenCalled();
  },
};

export const CurrentShop: Story = {
  args: { currentShop: { id: "tandem", name: "Lidl", nickname: "Tandem Centre Lidl" } },
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByText("You're at: Tandem Centre Lidl")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Scan item" }));
    await expect(args.onScan).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Change shop" }));
    await expect(args.onChooseShop).toHaveBeenCalled();
  },
};

export const CachedShops: Story = {
  args: CurrentShop.args,
  render: (args) => <>
    <ShopSyncFeedback sync={{ status: "cached", lastSyncedAt: "2026-11-20T04:00:00.000Z" }} />
    <ShopHome {...args} />
  </>,
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/^Last synced/)).toBeVisible();
    await expect(canvas.getByText("You're at: Tandem Centre Lidl")).toBeVisible();
  },
};

export const ShopsUnavailableOffline: Story = {
  render: (args) => <>
    <ShopSyncFeedback sync={{ status: "unavailable" }} />
    <ShopHome {...args} />
  </>,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Saved shops are unavailable offline. You can add a shop.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Select current shop" })).toBeVisible();
  },
};
