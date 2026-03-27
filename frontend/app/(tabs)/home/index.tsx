import BlurHeader from "@/components/BlurHeader";
import RobotStatus from "@/components/RobotStatus";
import React, { useCallback, useState } from "react";
import { Alert, Platform, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useCameraPermissions } from "expo-camera";

type Robot = { id: string; bot_id: string; linked_at: string };

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height: screenHeight } = useWindowDimensions();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [robots, setRobots] = useState<Robot[]>([]);

  // Reload robots every time this tab comes into focus (e.g. after scanning)
  useFocusEffect(
    useCallback(() => {
      const loadRobots = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('robots')
          .select('id, bot_id, linked_at')
          .eq('user_id', user.id)
          .order('linked_at', { ascending: false });
        if (data) setRobots(data);
      };
      loadRobots();
    }, [])
  );

  const handleRobotPress = async (robot: Robot) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('../login'); return; }

    const { data, error } = await supabase
      .from('hangars')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (error) { Alert.alert('Error', error.message); return; }

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
        style={{ flex: 1, backgroundColor: "#000" }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <View style={{
          padding: 20,
          paddingTop: Platform.OS === "android" ? 140 : insets.top - 40,
          gap: 20,
        }}>
          {/* Robot list */}
          {robots.length > 0 ? (
            robots.map((robot) => (
              <RobotStatus
                key={robot.id}
                isWorking={true}
                title={robot.bot_id}
                startTime={new Date(robot.linked_at).toLocaleString()}
                onPress={() => handleRobotPress(robot)}
              />
            ))
          ) : (
            <View style={{
              height: screenHeight * 0.7,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center' }}>
                No robots added yet
              </Text>
            </View>
          )}

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
