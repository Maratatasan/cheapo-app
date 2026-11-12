import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { PriceDisplay } from "../component/results/price-display";
const meta = {
  title: "Price/Pack and unit price",
  component: PriceDisplay,
  tags: ["autodocs"],
  args: {
    price: 2.5,
    currency: "GBP",
    unit_price: { amount: 1.25, unit: "kg" },
  },
} satisfies Meta<typeof PriceDisplay>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PerKilogram: Story = {};
export const PerLitre: Story = {
  args: { price: 1.39, unit_price: { amount: 0.695, unit: "litre" } },
};
export const PerItem: Story = {
  args: { price: 3, unit_price: { amount: 0.5, unit: "item" } },
};
export const UnknownUnitPrice: Story = { args: { unit_price: null } };
export const MissingPrices: Story = { args: { price: null, unit_price: null } };
