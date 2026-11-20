import { render, screen, userEvent } from "@testing-library/react-native";

import { StorageCache } from "../component/storage-cache";

test("shows measured cache bytes and only clears after confirmation", async () => {
  const user = userEvent.setup();
  let bytes = 12_800;
  const cache = {
    measureBytes: async () => bytes,
    clear: jest.fn(async () => { bytes = 0; }),
  };
  const back = jest.fn();
  await render(<StorageCache cache={cache} onBack={back} />);
  expect(await screen.findByText("12.5 KB")).toBeOnTheScreen();
  expect(screen.getByText(/original photos/)).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Clear cache" }));
  expect(screen.getByText(/unavailable offline/)).toBeOnTheScreen();
  expect(screen.getByText(/server records stay available/)).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Cancel" }));
  expect(cache.clear).not.toHaveBeenCalled();
  expect(screen.getByText("12.5 KB")).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Clear cache" }));
  await user.press(screen.getByRole("button", { name: "Clear downloaded copies" }));
  expect(cache.clear).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("0 B")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Clear cache" })).toBeDisabled();
  await user.press(screen.getByRole("button", { name: "Back to Home" }));
  expect(back).toHaveBeenCalledTimes(1);
});

test("offers remeasurement after a measuring problem", async () => {
  const user = userEvent.setup();
  const measureBytes = jest.fn(async () => 512).mockRejectedValueOnce(new Error("Unreadable cache"));
  const cache = { measureBytes, clear: jest.fn(async () => {}) };
  await render(<StorageCache cache={cache} onBack={() => {}} />);
  expect(await screen.findByText("Cache size unavailable.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Clear cache" })).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Measure again" }));
  expect(await screen.findByText("512 B")).toBeOnTheScreen();
  expect(cache.clear).not.toHaveBeenCalled();
});

test("reports failed clearing and remeasures before allowing a retry", async () => {
  const user = userEvent.setup();
  let bytes = 1024;
  const clear = jest.fn(async () => { bytes = 0; }).mockRejectedValueOnce(new Error("Cannot remove cache"));
  await render(<StorageCache cache={{ measureBytes: async () => bytes, clear }} onBack={() => {}} />);
  expect(await screen.findByText("1 KB")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Clear cache" }));
  await user.press(screen.getByRole("button", { name: "Clear downloaded copies" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not clear the cache. Try again.");
  expect(await screen.findByText("1 KB")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Clear cache" }));
  await user.press(screen.getByRole("button", { name: "Clear downloaded copies" }));
  expect(await screen.findByText("0 B")).toBeOnTheScreen();
  expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
});
