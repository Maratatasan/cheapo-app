import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { fn, expect } from "storybook/test";
import { DisplayState } from "../component/results/display-state";
const meta = {
  title: "Feedback/Display states",
  component: DisplayState,
  tags: ["autodocs"],
  args: {
    kind: "empty",
    title: "No observations yet",
    description:
      "A price photo can become a dated observation after you review it and confirm the shop.",
  },
} satisfies Meta<typeof DisplayState>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Loading: Story = {
  args: {
    kind: "loading",
    title: "Loading observations",
    description: "Your price notebook will appear here.",
  },
};
export const Error: Story = {
  args: {
    kind: "error",
    title: "Couldn’t load observations",
    description: "Please try again when you’re ready.",
    actionLabel: "Try again",
    onAction: fn(),
  },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(args.onAction).toHaveBeenCalled();
  },
};
