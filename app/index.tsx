import { Text, View, Button } from "react-native";
import { useRouter } from "expo-router";

export default function Index() {
  const router = useRouter();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text>Edit app/index.tsx to edit this screen. it works. iPhone.</Text>
      <Button
        title="Explore sample prices"
        color="#196747"
        onPress={() => router.push("/results")}
      />
      <Button
        title="Scan price"
        color="black"
        onPress={() => router.push("/scan")}
      />
    </View>
  );
}
