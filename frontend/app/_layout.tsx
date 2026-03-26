import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#000" },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="index" />
      </Stack>
    </GestureHandlerRootView>
  );
}
