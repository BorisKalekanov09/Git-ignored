import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface DashboardProps {
  onTabChange?: (tab: string) => void;
}

type TabType = 'Temperature' | 'Humidity' | 'Air quality';

const Dashboard: React.FC<DashboardProps> = ({ onTabChange }) => {
  const [activeTab, setActiveTab] = useState<TabType>('Temperature');

  const tabs: TabType[] = ['Temperature', 'Humidity', 'Air quality'];

  const handleTabPress = (tab: TabType) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  return (
    <View style={{ 
      backgroundColor: '#141414',
      borderRadius: 20,
      padding: 20,
      gap: 16 
    }}>
      {/* Header */}
      <Text style={{ color: 'white', fontSize: 20, fontWeight: '600' }}>Dashboard</Text>
      
      {/* Divider */}
      <View style={{ height: 1, backgroundColor: '#2C2C2E' }} />
      
      {/* Tab Selector - Matching contracts accordion style */}
      <View style={{
        backgroundColor: '#2C2C2E',
        borderRadius: 16,
        padding: 4,
        flexDirection: 'row',
      }}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            key={tab}
            onPress={() => handleTabPress(tab)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: activeTab === tab ? '#3A3A3C' : 'transparent',
            }}
            activeOpacity={0.7}
          >
            <Text style={{
              color: 'white',
              fontSize: 15,
              fontWeight: '600',
              textAlign: 'center',
            }}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      
      {/* Content Area - Empty for now matching contracts style */}
      <View style={{
        backgroundColor: '#1C1C1E',
        borderRadius: 16,
        padding: 20,
        minHeight: 200,
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Text style={{ color: '#8E8E93', fontSize: 15 }}>
          {activeTab} data visualization coming soon
        </Text>
      </View>
    </View>
  );
};

export default Dashboard;