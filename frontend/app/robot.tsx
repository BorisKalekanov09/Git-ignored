import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { supabase } from '@/lib/supabase';
import { siloSocket } from '@/services/websocket';
import SiloMap from '@/components/SiloMap';

// ── Types ───────────────────────────────────────────────────
type HeatPoint = { x: number; y: number; z: number; temp: number };
type SensorRecord = {
  id: number;
  temperature: number | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
};
type Cell = { id: string; index_x: number; index_y: number; status: string };
type Hangar = { id: string; width: number; height: number };

const SURFACE_Y = 2.9;
const CELL_SIZE_METERS = 0.2; // 20cm

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
  const [cells, setCells] = useState<Cell[]>([]);
  const [hangar, setHangar] = useState<Hangar | null>(null);

  const screenWidth = Dimensions.get('window').width - 32;

  const latestTemp = useMemo(() =>
    points.length > 0 ? points[points.length - 1].temp : 0
    , [points]);

  // Fetch hangar and cells from DB
  useEffect(() => {
    const loadHangarAndCells = async () => {
      const { data: hData } = await supabase.from('hangars').select('*').limit(1).maybeSingle();
      if (!hData) return;
      setHangar(hData);

      const { data: cData } = await supabase
        .from('cells')
        .select('*')
        .eq('hangar_id', hData.id)
        .order('index_y', { ascending: true })
        .order('index_x', { ascending: true });
      if (cData) setCells(cData);
    };

    loadHangarAndCells();

    // Subscribe to live cell status updates
    const sub = supabase
      .channel('cell-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'cells' }, (payload) => {
        setCells((current) => current.map(c => c.id === payload.new.id ? { ...c, status: payload.new.status } : c));
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, []);

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

  // Completed cell count for stats
  const completedCount = cells.filter(c => c.status === 'completed').length;
  const progressPct = cells.length > 0 ? Math.round((completedCount / cells.length) * 100) : 0;

  // Grid rendering — enforce min 18px per cell so it's always readable
  const MIN_CELL_PX = 18;
  const cols = hangar ? Math.ceil(hangar.width / CELL_SIZE_METERS) : 0;
  const naturalCellPx = cols > 0 ? screenWidth / cols : MIN_CELL_PX;
  const cellPx = Math.max(naturalCellPx, MIN_CELL_PX);
  const gridWidth = cols * cellPx;

  return (
    <View style={styles.container}>
      <ScrollView>
        {/* ── Progress bar ── */}
        {cells.length > 0 && (
          <View style={styles.progressWrapper}>
            <View style={[styles.progressBar, { width: `${progressPct}%` as any }]} />
            <Text style={styles.progressText}>{progressPct}% complete — {completedCount}/{cells.length} cells</Text>
          </View>
        )}

        {/* ── 3D box with cells on top face ── */}
        <SiloMap
          points={points}
          cells={cells}
          hangar={hangar}
        />

        {/* Generate cells button if needed */}
        {hangar && cells.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 20 }}>
            <Text style={{ color: '#aaa', marginBottom: 16 }}>No cells found. Tap below to generate the 20×20cm grid.</Text>
            <Text
              onPress={async () => {
                const w = hangar.width || 10;
                const h = hangar.height || 10;
                const cols = Math.ceil(w / CELL_SIZE_METERS);
                const rows = Math.ceil(h / CELL_SIZE_METERS);
                const newCells: any[] = [];
                for (let y = 0; y < rows; y++)
                  for (let x = 0; x < cols; x++)
                    newCells.push({ hangar_id: hangar.id, index_x: x, index_y: y, status: 'pending' });
                await supabase.from('cells').insert(newCells);
                const { data: cData } = await supabase.from('cells').select('*').eq('hangar_id', hangar.id);
                if (cData) setCells(cData);
              }}
              style={{ backgroundColor: '#EA575F', color: 'white', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, fontWeight: '700', fontSize: 16 }}
            >
              Generate Grid
            </Text>
          </View>
        )}

        {/* ── Stats ── */}
        <View style={styles.controls}>
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
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080A0D' },
  progressWrapper: {
    backgroundColor: '#1A1D21',
    borderRadius: 10,
    height: 28,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
  },
  progressText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    zIndex: 1,
  },
  noData: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 20, lineHeight: 22 },
  // Stats
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