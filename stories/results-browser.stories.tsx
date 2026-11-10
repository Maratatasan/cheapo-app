import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn } from "storybook/test";
import { ResultsBrowser } from "../component/results/results-browser";
import { observations } from "./fixtures";
const meta = {
  title: "Browsers/Results",
  component: ResultsBrowser,
  args: { observations, onShop: fn() },
  parameters: {
    docs: {
      description: {
        component:
          "Actual app comparison browser. Sample data only; no network, camera, storage or navigation provider.",
      },
    },
  },
} satisfies Meta<typeof ResultsBrowser>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compare: Story = {};
export const Nearest: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Nearest" }));
    await expect(
      canvas.getByText(
        "Illustrative distances only. Your location is not used.",
      ),
    ).toBeVisible();
  },
};
export const EmptySearch: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search sample observations" }),
      "not a product",
    );
    await expect(canvas.getByText("No observations yet")).toBeVisible();
  },
};
export const Empty: Story = { args: { observations: [] } };
export const Loading: Story = { args: { state: "loading" } };
export const Error: Story = { args: { state: "error", onRetry: fn() } };
