import { Text, View } from "react-native";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { ObservationCard } from "../component/results/observation-card";
import { ShopCard } from "../component/results/shop-card";
import { DisplayState } from "../component/results/display-state";
import { SampleNotice } from "../component/results/sample-notice";
import { color, ui } from "../component/results/theme";
import { potatoes } from "./fixtures";
function Library() {
  return (
    <View style={{ gap: 18 }}>
      <Text style={ui.title}>Cheapo, piece by piece.</Text>
      <Text style={ui.body}>
        The same components power the app and these examples.
      </Text>
      <SampleNotice />
      <ObservationCard item={potatoes} />
      <ShopCard
        shop="Aldi"
        area="Colliers Wood · branch unverified"
        price={2.5}
        currency="GBP"
        number={2}
        selected
        onSelect={() => {}}
      />
      <DisplayState
        kind="empty"
        title="Nothing saved yet"
        description="Review a price photo and confirm the shop to build a useful price notebook."
      />
      <Text style={[ui.small, { color: color.green }]}>
        Browser component previews · native maps and camera checked separately.
      </Text>
    </View>
  );
}
const meta = { title: "Cheapo/Library", component: Library } satisfies Meta<
  typeof Library
>;
export default meta;
export const Overview: StoryObj<typeof meta> = {};
