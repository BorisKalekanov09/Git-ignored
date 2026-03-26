import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface RobotStatusProps {
  isWorking: boolean;
  startTime?: string;
  onPress?: () => void;
}

const RobotStatus: React.FC<RobotStatusProps> = ({ 
  isWorking = true, 
  startTime = "January 8, 2026 14:42",
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
        <Text style={{ color: 'white', fontSize: 20, fontWeight: '600' }}>Robot</Text>
        {isWorking && (
          <View style={{
            width: 32,
            height: 32,
            justifyContent: 'center',
            alignItems: 'center',
          }}>
            <LinearGradient
              colors={['#EA575F', '#EA575F']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                justifyContent: 'center',
                alignItems: 'center',
                transform: [{ rotate: '45deg' }],
              }}
            >
              <View style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                backgroundColor: '#141414',
              }} />
            </LinearGradient>
          </View>
        )}
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