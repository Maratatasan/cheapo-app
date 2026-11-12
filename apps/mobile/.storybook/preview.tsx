import type { Preview } from "@storybook/react-native-web-vite";
import { View, Text } from "react-native";
import { color } from "../component/results/theme";
const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    options: {
      storySort: {
        order: ["Cheapo", "Cards", "Price", "Feedback", "Browsers"],
      },
    },
  },
  decorators: [
    (Story, { parameters }) => parameters.componentLibraryFrame === false ? <Story /> : (
      <View
        style={{
          backgroundColor: color.cream,
          padding: 20,
          maxWidth: 600,
          width: "100%",
          gap: 16,
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontWeight: "800",
            letterSpacing: 1,
            color: color.green,
          }}
        >
          CHEAPO COMPONENTS · SAMPLE DATA
        </Text>
        <Story />
      </View>
    ),
  ],
};
export default preview;
