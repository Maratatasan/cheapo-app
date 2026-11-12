import { ScrollView, Pressable, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { ResultsBrowser } from "@/component/results/results-browser";
import { SampleNotice } from "@/component/results/sample-notice";
import { ui } from "@/component/results/theme";
import { sampleObservations } from "@/data/sample-observations";
export default function ResultsScreen() {
  const router = useRouter();
  return (
    <View style={ui.page}>
      <Stack.Screen
        options={{
          title: "Price notebook",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "#F7F7F0" },
        }}
      />
      <ScrollView contentContainerStyle={ui.content}>
        <View style={ui.between}>
          <Text style={ui.eyebrow}>CHEAPO / YOUR PRICE NOTEBOOK</Text>
          <View style={ui.pill}>
            <Text style={ui.pillText}>Sample data</Text>
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <Text style={ui.title}>
            A little more clarity.{"\n"}A little less spend.
          </Text>
          <Text style={ui.body}>
            Compare dated price observations, then see which shop suits your
            trip.
          </Text>
        </View>
        <SampleNotice />
        <View style={ui.between}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/scan")}
            style={[ui.button, { flex: 1 }]}
          >
            <Text style={ui.buttonText}>Scan a price</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/shops")}
            style={[ui.button, { flex: 1, backgroundColor: "#E7F1E8" }]}
          >
            <Text style={[ui.buttonText, { color: "#196747" }]}>
              Explore shop map ↗
            </Text>
          </Pressable>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 23, fontWeight: "800", color: "#183D32" }}>
            Milk, compared
          </Text>
          <Text style={ui.body}>
            Example 2 litre packs · own-label brands differ
          </Text>
        </View>
        <ResultsBrowser
          observations={sampleObservations}
          onShop={(id) =>
            router.push({ pathname: "/shops", params: { shop: id } })
          }
        />
        <Text style={ui.small}>
          A photo becomes a useful observation when its product, price, offer
          and shop have been reviewed. A dated observation never guarantees
          today’s price or availability.
        </Text>
      </ScrollView>
    </View>
  );
}
