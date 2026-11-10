import type { StorybookConfig } from "@storybook/react-native-web-vite";
import { fileURLToPath } from "node:url";
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs"],
  framework: "@storybook/react-native-web-vite",
  core: { disableTelemetry: true },
  viteFinal: async (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        "@": fileURLToPath(new URL("../", import.meta.url)),
      },
    },
  }),
};
export default config;
