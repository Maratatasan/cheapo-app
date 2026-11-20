import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect } from "storybook/test";
import { View } from "react-native";

import { StorageCache } from "../component/storage-cache";

type Fixture = "downloaded" | "empty" | "unavailable" | "clear-failure" | "legacy";

function Preview({ fixture }: { fixture: Fixture }) {
  const cache = useMemo(() => {
    let downloadedBytes = fixture === "empty" ? 0 : 12_800;
    return {
      async measureBytes() {
        if (fixture === "unavailable") throw Error("Synthetic measurement failure");
        return downloadedBytes;
      },
      async clear() {
        if (fixture === "clear-failure") throw Error("Synthetic cache removal failure");
        downloadedBytes = 0;
      },
    };
  }, [fixture]);
  const legacyCleanup = fixture === "legacy" ? async () => ({ removedPrices: 8, keptPrices: 2, failedParts: 0, barcodeCatalog: "kept" as const, savedShopsCleared: true }) : undefined;
  return (
    <View style={{ width: "100%", maxWidth: 420, height: 600, alignSelf: "center" }}>
      <StorageCache cache={cache} legacyCleanup={legacyCleanup} onBack={() => {}} />
    </View>
  );
}

const meta = {
  title: "Screens/Storage & cache",
  component: Preview,
  args: { fixture: "downloaded" },
} satisfies Meta<typeof Preview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Downloaded: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("12.5 KB")).toBeVisible();
  },
};

export const Empty: Story = {
  args: { fixture: "empty" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("0 B")).toBeVisible();
  },
};

export const Unavailable: Story = {
  args: { fixture: "unavailable" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Cache size unavailable.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Measure again" })).toBeVisible();
  },
};

export const Confirming: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("12.5 KB");
    await userEvent.click(canvas.getByRole("button", { name: "Clear cache" }));
    await expect(await canvas.findByText(/unavailable offline/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeVisible();
  },
};

export const ClearFailure: Story = {
  args: { fixture: "clear-failure" },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("12.5 KB");
    await userEvent.click(canvas.getByRole("button", { name: "Clear cache" }));
    await userEvent.click(canvas.getByRole("button", { name: "Clear downloaded copies" }));
    await expect(await canvas.findByText(/Could not clear the cache/)).toBeVisible();
  },
};

export const ConfirmOrCancel: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findByText("12.5 KB");
    await userEvent.click(canvas.getByRole("button", { name: "Clear cache" }));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(canvas.getByText("12.5 KB")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Clear cache" }));
    await userEvent.click(canvas.getByRole("button", { name: "Clear downloaded copies" }));
    await expect(await canvas.findByText("0 B")).toBeVisible();
  },
};


export const ConfirmLegacyRemoval: Story = {
  args: { fixture: "legacy" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Remove old phone data" }));
    await expect(canvas.getByRole("heading", { name: "Remove old phone data?" })).toBeVisible();
    await expect(canvas.getByText(/Shared history, unfinished drafts, pending work, sign-ins, exports/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Cancel removal" })).toBeVisible();
  },
};
