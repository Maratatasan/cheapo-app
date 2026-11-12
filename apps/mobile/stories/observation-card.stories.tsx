import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { fn, expect } from "storybook/test";
import { ObservationCard } from "../component/results/observation-card";
import { milk, loyaltyMilk, unclear, potatoes, longName } from "./fixtures";
const meta = {
  title: "Cards/Observation card",
  component: ObservationCard,
  tags: ["autodocs"],
  args: { item: milk, onShop: fn() },
  parameters: {
    docs: {
      description: {
        component:
          "The same dated observation card used in results and selected-shop views. All examples are fictional. Pack and unit prices are independent; unknown values stay explicit.",
      },
    },
  },
} satisfies Meta<typeof ObservationCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WeightUnit: Story = {
  args: { item: potatoes },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("£2.50")).toBeVisible();
    await expect(canvas.getByText("£1.25 / kg")).toBeVisible();
  },
};
export const LoyaltyOffer: Story = { args: { item: loyaltyMilk } };
export const NeedsReview: Story = { args: { item: unclear } };
export const LongNames: Story = { args: { item: longName } };
export const WithoutAction: Story = { args: { onShop: undefined } };
export const OpenShop: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "See Aldi on map" }),
    );
    await expect(args.onShop).toHaveBeenCalled();
  },
};
