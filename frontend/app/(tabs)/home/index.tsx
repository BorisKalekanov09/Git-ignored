import BlurHeader from "@/components/BlurHeader";
import RobotStatus from "@/components/RobotStatus";
import React from "react";
import { Alert, Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useCameraPermissions } from "expo-camera";

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  
  const handleRobotPress = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('../login');
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
      router.push('../hangarsettings');
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

          {/* Add Bot button */}
          <TouchableOpacity
            onPress={async () => {
              if (!cameraPermission?.granted) {
                const result = await requestCameraPermission();
                if (!result.granted) return;
              }
              router.push('/scanrobot');
            }}
            activeOpacity={0.8}
            style={{
              backgroundColor: '#EA575F',
              borderRadius: 26,
              padding: 18,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>+ Add Bot</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );
};

export default HomeScreen;
