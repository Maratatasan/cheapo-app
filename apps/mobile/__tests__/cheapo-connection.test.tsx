import { fireEvent, render, screen } from "@testing-library/react-native";

import { CheapoConnection } from "../component/cheapo-connection";
import { CheapoAccessError } from "../lib/cheapo-access/client";

test("shows ended access, accepts a replacement, then clears the credential", async () => {
  const access = {
    check: async () => "denied" as const,
    enroll: jest.fn(async (_value: string) => {}),
    clear: jest.fn(async () => {}),
  };
  const onBack = jest.fn();
  await render(<CheapoConnection access={access} onBack={onBack} />);
  expect(await screen.findByText(/Cheapo access ended/)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Use new credential" })).toBeDisabled();
  const input = screen.getByLabelText("Device credential");
  expect(input.props.secureTextEntry).toBe(true);

  const synthetic = `cheapo_${"A".repeat(43)}`;
  await fireEvent.changeText(input, synthetic);
  await fireEvent.press(screen.getByRole("button", { name: "Use new credential" }));
  expect(await screen.findByText("This phone is connected.")).toBeOnTheScreen();
  expect(access.enroll).toHaveBeenCalledWith(synthetic);
  expect(screen.getByLabelText("Device credential")).toHaveProp("value", "");
  await fireEvent.press(screen.getByRole("button", { name: "Clear credential" }));
  expect(await screen.findByText("This phone is not connected.")).toBeOnTheScreen();
  expect(access.clear).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "Back to Home" }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test("preserves the connected state and reports a denied replacement", async () => {
  const access = {
    check: async () => "connected" as const,
    enroll: async () => { throw new CheapoAccessError("Ask your operator for a replacement."); },
    clear: async () => {},
  };
  await render(<CheapoConnection access={access} onBack={() => {}} />);
  expect(await screen.findByText("This phone is connected.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Device credential"), "synthetic");
  await fireEvent.press(screen.getByRole("button", { name: "Use new credential" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ask your operator for a replacement.");
  expect(screen.getByText("This phone is connected.")).toBeOnTheScreen();
});
