import BlurHeader from "@/components/BlurHeader";
import React from "react";
import { Platform, ScrollView, StyleSheet } from "react-native";

const HomeScreen = () => {
  return (
    <>
      {Platform.OS === "android" && <BlurHeader title="Home" />}
      <ScrollView
        style={styles.container}
        contentInsetAdjustmentBehavior="automatic"
      >
      </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
});

export default HomeScreen;
