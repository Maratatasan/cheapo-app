import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { ShopForm } from "@/component/shop/shop-form";

const emptyValues = { nickname: "", name: "", address: "" };

test("submits a nickname without a shop name or address", async () => {
  const onSubmit = jest.fn();

  function Form() {
    const [values, setValues] = useState(emptyValues);
    return (
      <ShopForm
        values={values}
        onChange={setValues}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />
    );
  }

  await render(<Form />);
  await fireEvent.changeText(screen.getByLabelText("Nickname"), "Tandem Centre Lidl");
  await fireEvent.press(screen.getByRole("button", { name: "Save shop" }));

  expect(onSubmit).toHaveBeenCalledWith({
    nickname: "Tandem Centre Lidl",
    name: "",
    address: "",
  });
});

test("requires at least one non-blank name", async () => {
  const onSubmit = jest.fn();
  await render(
    <ShopForm
      values={{ ...emptyValues, nickname: "   ", address: "Tandem Centre" }}
      onChange={jest.fn()}
      onSubmit={onSubmit}
      onCancel={jest.fn()}
    />,
  );

  await fireEvent.press(screen.getByRole("button", { name: "Save shop" }));

  expect(screen.getByText("Enter a nickname or shop name.")).toBeOnTheScreen();
  expect(onSubmit).not.toHaveBeenCalled();
});

test("accepts a shop name alone and exposes Cancel", async () => {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  const values = { ...emptyValues, name: "Lidl" };
  await render(
    <ShopForm values={values} onChange={jest.fn()} onSubmit={onSubmit} onCancel={onCancel} />,
  );

  await fireEvent.press(screen.getByRole("button", { name: "Save shop" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));

  expect(onSubmit).toHaveBeenCalledWith(values);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test("surfaces an external save error and prevents resubmission while busy", async () => {
  const props = {
    values: { ...emptyValues, nickname: "Tandem Centre Lidl" },
    onChange: jest.fn(),
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
  };
  await render(<ShopForm {...props} error="Could not save the shop. Try again." />);
  expect(screen.getByText("Could not save the shop. Try again.")).toBeOnTheScreen();

  await screen.rerender(<ShopForm {...props} isSubmitting />);

  const saving = screen.getByRole("button", { name: "Saving shop…" });
  expect(saving).toBeDisabled();
  await fireEvent.press(saving);
  expect(props.onSubmit).not.toHaveBeenCalled();
});
