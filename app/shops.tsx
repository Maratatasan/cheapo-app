import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { ShopsBrowser } from "@/component/results/shops-browser";
import { SampleNotice } from "@/component/results/sample-notice";
import { ui } from "@/component/results/theme";
import { sampleObservations } from "@/data/sample-observations";
export default function ShopsScreen() {
  const { shop } = useLocalSearchParams<{ shop?: string }>();
  return (
    <View style={ui.page}>
      <Stack.Screen
        options={{
          title: "Shop map",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "#F7F7F0" },
        }}
      />
      <ScrollView contentContainerStyle={ui.content}>
        <View style={ui.between}>
          <Text style={ui.eyebrow}>CHEAPO / SHOP EXPLORER</Text>
          <View style={ui.pill}>
            <Text style={ui.pillText}>Sample data</Text>
          </View>
        </View>
        <Text style={ui.title}>Put your options{"\n"}in perspective.</Text>
        <Text style={ui.body}>
          Explore example shops around Colliers Wood and Wimbledon. Tap a pin to
          see its sample observation.
        </Text>
        <SampleNotice map />
        <ShopsBrowser observations={sampleObservations} initialId={shop} />
        <Text style={ui.small}>
          Exact branches have not been verified. No location access, directions
          or stock information are used.
        </Text>
      </ScrollView>
    </View>
  );
}
