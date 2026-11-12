import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { OfferNotice } from "../component/results/offer-notice";
const meta = {
  title: "Feedback/Offer and uncertainty",
  component: OfferNotice,
  tags: ["autodocs"],
  args: { condition: "No offer conditions in this example" },
} satisfies Meta<typeof OfferNotice>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Plain: Story = {};
export const LoyaltyOffer: Story = {
  args: { condition: "Example loyalty price · membership required" },
};
export const Uncertainty: Story = {
  args: {
    condition: "Offer conditions need review",
    uncertainty:
      "The pack size is partly obscured. Check the photo before comparing the unit price.",
  },
};
export const MissingCondition: Story = { args: { condition: null } };
