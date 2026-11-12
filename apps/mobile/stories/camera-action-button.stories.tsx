import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { fn } from "storybook/test";
import { View } from "react-native";
import { CameraActionButton } from "../component/camera-actions";

const meta = {
  title: "Components/Camera action button",
  component: CameraActionButton,
  args: { onPress: fn() },
  decorators: [
    Story => <View style={{ width: "100%", maxWidth: 360, padding: 16, backgroundColor: "#000" }}><Story /></View>,
  ],
} satisfies Meta<typeof CameraActionButton>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Primary: Story = { args: { label: "Take Picture of Price", primary: true } };
export const Secondary: Story = { args: { label: "Choose photo" } };
export const Busy: Story = { args: { label: "Taking picture…", primary: true, busy: true } };
