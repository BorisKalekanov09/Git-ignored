import BlurHeader from "@/components/BlurHeader";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

export default function SettingsScreen() {
  return (
    <>
      {Platform.OS === "android" && <BlurHeader title="Settings" />}
      <View style={styles.container}>
        <Text style={styles.text}>Settings</Text>
        <Text style={styles.subtext}>Configuration options coming soon</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },
  subtext: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
    marginTop: 8,
  },
});
