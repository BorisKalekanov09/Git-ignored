import BlurHeader from "@/components/BlurHeader";
import RobotStatus from "@/components/RobotStatus";
import Dashboard from "@/components/Dashboard";
import React, { useState } from "react";
import { Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const handleRobotPress = () => {
    // Navigate to robot.tsx
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
            : insets.top -40, // iOS with native header - reduced from 100 to 60
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

          {/* Login button */}
          <TouchableOpacity onPress={() => router.push('/login')} activeOpacity={0.8}>
            <LinearGradient
              colors={['#4f8ef7', '#6ea8ff']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                backgroundColor: '#141414',
                borderRadius: 26,
                padding: 16,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Go to Login</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );
};

export default HomeScreen;
