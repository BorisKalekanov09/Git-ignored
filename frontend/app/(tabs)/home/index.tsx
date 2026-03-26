import BlurHeader from "@/components/BlurHeader";
import RobotStatus from "@/components/RobotStatus";
import React from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const handleRobotPress = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const { data, error } = await supabase
      .from('hangars')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    if (!data) {
      router.push('/hangarsettings');
    } else {
      router.push('/robot');
    }
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
            ? 140
            : insets.top - 40,
          gap: 20,
        }}>
          <RobotStatus
            isWorking={true}
            startTime="January 8, 2026 14:42"
            onPress={handleRobotPress}
          />
        </View>
      </ScrollView>
    </>
  );
};

export default HomeScreen;
