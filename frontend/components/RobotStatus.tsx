import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { useAnimatedProps } from 'react-native-reanimated';
import { Svg, Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const radius = 11;
const circumference = 2 * Math.PI * radius;

function CircularProgress({ progress }: { progress: number }) {
  const strokeDashoffset = circumference - progress * circumference;

  return (
    <Animated.View
      style={{
        width: 26,
        height: 26,
        transform: [{ rotate: '-90deg' }],
      }}
    >
      <Svg width="26" height="26" viewBox="0 0 26 26">
        {/* Background circle */}
        <Circle
          cx="13"
          cy="13"
          r={radius}
          stroke="#3A3A3C"
          strokeWidth="4.5"
          fill="none"
        />
        {/* Progress circle */}
        <Circle
          cx="13"
          cy="13"
          r={radius}
          stroke="#EA575F"
          strokeWidth="4.5"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

interface RobotStatusProps {
  isWorking: boolean;
  progress?: number; // 0 to 1
  startTime?: string;
  title?: string;
  onPress?: () => void;
}

const RobotStatus: React.FC<RobotStatusProps> = ({ 
  isWorking = true,
  progress = 0.65,
  startTime = "January 8, 2026 14:42",
  title = 'Robot',
  onPress 
}) => {
  const formatTimestamp = (timestamp: string) => {
    return `Started at: ${timestamp}`;
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{ 
        backgroundColor: '#141414',
        borderRadius: 26,
        padding: 14,
        gap: 14 
      }}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: 'white', fontSize: 20, fontWeight: '600' }}>{title}</Text>
        {isWorking && <CircularProgress progress={progress} />}
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
          justifyContent: 'center'
        }}
      >
        <Text style={{ color: isWorking ? '#9F9FA1' : '#8E8E93', fontSize: 17 }}>
          {isWorking ? 'Currently in progress...' : 'There is currently no robot activity!'}
        </Text>
      </View>
      {isWorking && startTime && (
        <Text style={{ color: '#8E8E93', fontSize: 13, textAlign: 'center' }}>
          {formatTimestamp(startTime)}
        </Text>
      )}
    </TouchableOpacity>
  );
};

export default RobotStatus;