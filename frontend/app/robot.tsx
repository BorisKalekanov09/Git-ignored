import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { siloSocket } from '@/services/websocket';
import SiloMap from '@/components/SiloMap'; // Import the new refactored component

// Types
type HeatPoint = { x: number; y: number; z: number; temp: number };
type SensorRecord = {
  id: number;
  temperature: number | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
};

const SURFACE_Y = 2.9;

// Supabase Init
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabase = createClient(supabaseUrl, supabaseAnon);

/**
 * Mapping helper to convert DB records to 3D points
 */
function toSurfacePoints(records: SensorRecord[]): HeatPoint[] {
  if (!records.length) return [{ x: 0, y: SURFACE_Y, z: 0, temp: 25 }];
  return records.map((r) => ({
    x: (Number(r.longitude) || 0) * 2, 
    y: SURFACE_Y,
    z: (Number(r.latitude) || 0) * 2,
    temp: Number(r.temperature) || 0,
  }));
}

export default function RobotScreen() {
  const [points, setPoints] = useState<HeatPoint[]>([]);
  const [dbCount, setDbCount] = useState(0);
  
  const latestTemp = useMemo(() => 
    points.length > 0 ? points[points.length - 1].temp : 0
  , [points]);

  // Handle Initial DB Load & Polling Fallback
  useEffect(() => {
    let mounted = true;

    const loadLatestFromDb = async () => {
      const { data, error } = await supabase
        .from('sensor_data')
        .select('id, temperature, latitude, longitude, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error || !mounted || !data) return;

      const surfacePoints = toSurfacePoints([...data].reverse());
      setPoints(surfacePoints);
      setDbCount(surfacePoints.length);
    };

    loadLatestFromDb();
    const id = setInterval(loadLatestFromDb, 5000); // Poll every 5s as backup
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Handle Live WebSocket Stream
  useEffect(() => {
    siloSocket.connect();

    const off = siloSocket.onSensorData((newData: any) => {
      const livePoint = toSurfacePoints([{
        id: Date.now(),
        temperature: Number(newData.temperature ?? newData.temp) || 0,
        latitude: Number(newData.latitude ?? newData.y) || 0,
        longitude: Number(newData.longitude ?? newData.x) || 0,
        created_at: new Date().toISOString(),
      }])[0];

      setPoints((current) => [...current.slice(-149), livePoint]);
    });

    return () => off();
  }, []);

  return (
    <View style={styles.container}>
      {/* Reusable 3D Map Component */}
      <SiloMap points={points} />
      
      <ScrollView contentContainerStyle={styles.controls}>
        <Text style={styles.title}>Submarine Status</Text>
        <Text style={styles.status}>Live Tactical Mapping Active</Text>
        
        <View style={styles.infoBox}>
          <View style={styles.row}>
            <Text style={styles.infoLabel}>Surface Nodes:</Text>
            <Text style={styles.infoValue}>{points.length}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.infoLabel}>Live Temp:</Text>
            <Text style={[styles.infoValue, { color: latestTemp > 35 ? '#FF4B5F' : '#0bff50' }]}>
              {latestTemp.toFixed(1)}°C
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.infoLabel}>Sync Source:</Text>
            <Text style={styles.infoValue}>Supabase DB ({dbCount})</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080A0D' },
  controls: { padding: 20 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  status: { color: '#0bff50', fontSize: 14, marginTop: 4, marginBottom: 20 },
  infoBox: {
    padding: 15,
    backgroundColor: '#1A1D21',
    borderRadius: 12,
    gap: 8
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { color: '#999', fontSize: 14 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '600' }
});