import { useAuth } from "@/context/AuthContext";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color="#EA575F" size="large" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  return <Redirect href="/(tabs)/home" />;
}
