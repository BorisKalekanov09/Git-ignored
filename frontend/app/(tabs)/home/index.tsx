import BlurHeader from "@/components/BlurHeader";
import RobotStatus from "@/components/RobotStatus";
import Dashboard from "@/components/Dashboard";
import React, { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const handleRobotPress = () => {
    router.push('/robot');
  };

  const handleTabChange = (tab: string) => {
    // TODO: Handle tab change logic
    console.log('Tab changed to:', tab);
  };

  return (
    <>
      {Platform.OS === "android" && <BlurHeader title="Overview" />}
      <ScrollView
        style={{
          flex: 1,
          backgroundColor: "#000",
        }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <View style={{
          padding: 20,
          paddingTop: Platform.OS === "android" 
            ? 140 // Android with BlurHeader
            : insets.top -40, // iOS with native header - reduced from 100 to -40(up)
          gap: 20, // Consistent spacing between components
        }}>
          <RobotStatus
            isWorking={true}
            startTime="January 8, 2026 14:42"
            onPress={handleRobotPress}
          />
          
          <Dashboard
            onTabChange={handleTabChange}
          />
        </View>
      </ScrollView>
    </>
  );
};

export default HomeScreen;
