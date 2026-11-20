import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fireEvent } from "storybook/test";

import { CheapoConnection } from "../component/cheapo-connection";
import type { AccessState } from "../lib/cheapo-access/client";

function Preview({ status }: { status: AccessState }) {
  const access = useMemo(() => ({
    check: async () => status,
    enroll: async () => {},
    clear: async () => {},
  }), [status]);
  return <CheapoConnection access={access} />;
}

const meta = {
  title: "Screens/Cheapo access",
  component: Preview,
  args: { status: "missing" },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NewPhone: Story = {};
export const Connected: Story = { args: { status: "connected" } };
export const AccessEnded: Story = { args: { status: "denied" } };
export const Offline: Story = { args: { status: "unavailable" } };

export const ReplaceAndClear: Story = {
  args: { status: "denied" },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText(/Cheapo access ended/)).toBeVisible();
    const input = canvas.getByLabelText("Device credential");
    await fireEvent.change(input, { target: { value: "sample only" } });
    await userEvent.click(canvas.getByRole("button", { name: "Use new credential" }));
    await expect(await canvas.findByText("This phone is connected.")).toBeVisible();
    await expect(input).toHaveValue("");
    await userEvent.click(canvas.getByRole("button", { name: "Clear credential" }));
    await expect(await canvas.findByText("This phone is not connected.")).toBeVisible();
  },
};
