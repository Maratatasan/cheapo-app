import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn } from "storybook/test";
import { ShopForm, type ShopFormProps } from "../component/shop/shop-form";

const meta = {
  title: "Shops/Shop form",
  component: ShopForm,
  tags: ["autodocs"],
  args: {
    values: { nickname: "", name: "", address: "" },
    onChange: fn(),
    onSubmit: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ShopForm>;
export default meta;
type Story = StoryObj<typeof meta>;

function EditableShopForm(props: ShopFormProps) {
  const [values, setValues] = useState(props.values);
  return (
    <ShopForm
      {...props}
      values={values}
      onChange={(nextValues) => {
        setValues(nextValues);
        props.onChange(nextValues);
      }}
    />
  );
}

export const Empty: Story = { render: (args) => <EditableShopForm {...args} /> };
export const Invalid: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save shop" }));
    await expect(canvas.getByText("Enter a nickname or shop name.")).toBeVisible();
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};
export const Submitting: Story = {
  args: { values: { nickname: "Tandem Centre Lidl", name: "", address: "" }, isSubmitting: true },
};
export const NicknameOnly: Story = {
  args: { values: { nickname: "Tandem Centre Lidl", name: "", address: "" } },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save shop" }));
    await expect(args.onSubmit).toHaveBeenCalledWith({
      nickname: "Tandem Centre Lidl",
      name: "",
      address: "",
    });
  },
};
