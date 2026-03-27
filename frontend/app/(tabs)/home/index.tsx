import BlurHeader from "@/components/BlurHeader";
import RobotStatus from "@/components/RobotStatus";
import React, { useCallback, useState } from "react";
import { Alert, Platform, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useCameraPermissions } from "expo-camera";

type Robot = { id: string; bot_id: string; linked_at: string };
type DeploymentInfo = {
  isActive: boolean;
  progress: number; // 0–1
  startedAt: string | null;
};

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height: screenHeight } = useWindowDimensions();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [robots, setRobots] = useState<Robot[]>([]);
  const [deploymentInfo, setDeploymentInfo] = useState<DeploymentInfo>({
    isActive: false,
    progress: 0,
    startedAt: null,
  });

  // Reload robots + deployment every time this tab comes into focus
  useFocusEffect(
    useCallback(() => {
      const loadData = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Robots
        const { data: robotData } = await supabase
          .from('robots')
          .select('id, bot_id, linked_at')
          .eq('user_id', user.id)
          .order('linked_at', { ascending: false });
        if (robotData) setRobots(robotData);

        // Hangar for this user
        const { data: hangar } = await supabase
          .from('hangars')
          .select('id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!hangar) return;

        // Latest deployment (active first, else most recent)
        const { data: dep } = await supabase
          .from('deployments')
          .select('status, started_at')
          .eq('hangar_id', hangar.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Cell coverage
        const { data: cells } = await supabase
          .from('cells')
          .select('status')
          .eq('hangar_id', hangar.id);

        const total = cells?.length ?? 0;
        const visited = cells?.filter(c => c.status !== 'pending').length ?? 0;

        setDeploymentInfo({
          isActive: dep?.status === 'active',
          progress: total > 0 ? visited / total : 0,
          startedAt: dep?.started_at ?? null,
        });
      };

      loadData();
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
                isWorking={deploymentInfo.isActive}
                progress={deploymentInfo.progress}
                startTime={deploymentInfo.startedAt}
                title={robot.bot_id}
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
