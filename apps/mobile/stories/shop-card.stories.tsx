import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { fn, expect } from "storybook/test";
import { ShopCard, ShopCardProps } from "../component/results/shop-card";
const meta = {
  title: "Cards/Shop card",
  component: ShopCard,
  tags: ["autodocs"],
  args: {
    shop: "Aldi",
    area: "Colliers Wood · branch unverified",
    price: 1.39,
    currency: "GBP",
    number: 2,
    selected: false,
    onSelect: fn(),
  },
} satisfies Meta<typeof ShopCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Nickname: Story = {
  args: { shop: { id: "tandem", name: "Lidl", nickname: "Tandem Centre Lidl" } },
};
export const ShopName: Story = { args: { shop: { id: "lidl", name: "Lidl" } } };
export const Selected: Story = { args: { selected: true } };
export const LongBranch: Story = {
  args: {
    shop: "Example neighbourhood supermarket and food hall",
    area: "Wimbledon · long example branch description, exact location unverified",
    price: null,
  },
};
function Selectable(props: ShopCardProps) {
  const [selected, setSelected] = useState(false);
  return (
    <ShopCard
      {...props}
      selected={selected}
      onSelect={() => {
        setSelected(true);
        props.onSelect();
      }}
    />
  );
}
export const SelectShop: Story = {
  render: (args) => <Selectable {...args} />,
  play: async ({ canvas, userEvent, args }) => {
    const card = canvas.getByRole("button", { name: "Select Aldi" });
    await userEvent.click(card);
    await expect(card).toHaveAttribute("aria-selected", "true");
    await expect(args.onSelect).toHaveBeenCalled();
  },
};
