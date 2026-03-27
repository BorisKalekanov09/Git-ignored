import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { Svg, Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const radius = 11;
const circumference = 2 * Math.PI * radius;

function CircularProgress({ progress }: { progress: number }) {
  const progressSV = useSharedValue(0);

  useEffect(() => {
    progressSV.value = withTiming(progress, { duration: 700 });
    // progressSV is a stable shared value ref — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference - progressSV.value * circumference,
  }));

  return (
    <Animated.View
      style={{
        width: 26,
        height: 26,
        transform: [{ rotate: '-90deg' }],
      }}
    >
      <Svg width="26" height="26" viewBox="0 0 26 26">
        <Circle
          cx="13"
          cy="13"
          r={radius}
          stroke="#3A3A3C"
          strokeWidth="4.5"
          fill="none"
        />
        <AnimatedCircle
          cx="13"
          cy="13"
          r={radius}
          stroke="#EA575F"
          strokeWidth="4.5"
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

interface RobotStatusProps {
  isWorking: boolean;
  progress?: number; // 0 to 1
  startTime?: string | null;
  title?: string;
  onPress?: () => void;
}

const RobotStatus: React.FC<RobotStatusProps> = ({
  isWorking = false,
  progress = 0,
  startTime = null,
  title = 'Robot',
  onPress,
}) => {
  const pct = Math.round((progress ?? 0) * 100);

  const statusText = isWorking
    ? `Scanning in progress — ${pct}% covered`
    : 'No active deployment';

  const timeLabel = isWorking && startTime
    ? `Started at: ${new Date(startTime).toLocaleString()}`
    : !isWorking && startTime
    ? `Last deployment: ${new Date(startTime).toLocaleString()}`
    : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        backgroundColor: '#141414',
        borderRadius: 26,
        padding: 14,
        gap: 14,
      }}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: 'white', fontSize: 20, fontWeight: '600' }}>{title}</Text>
        <CircularProgress progress={progress ?? 0} />
      </View>

      {/* Divider */}
      <View style={{ height: 1, backgroundColor: '#2C2C2E' }} />

      {/* Status Card */}
      <View
        style={{
          backgroundColor: '#1C1C1E',
          borderRadius: 20,
          padding: 16,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: isWorking ? '#9F9FA1' : '#8E8E93', fontSize: 17 }}>
          {statusText}
        </Text>
      </View>

      {timeLabel && (
        <Text style={{ color: '#8E8E93', fontSize: 13, textAlign: 'center' }}>
          {timeLabel}
        </Text>
      )}
    </TouchableOpacity>
  );
};

export default RobotStatus;