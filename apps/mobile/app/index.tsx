import { Text, View, Button } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";

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
      {Constants.expoConfig?.extra?.directAuthTest === true && (
        <Button title="Direct phone sign-in test" onPress={() => router.push('/direct-auth')} />
      )}
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
