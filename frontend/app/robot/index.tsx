import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Pressable,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BlurHeader from '@/components/BlurHeader';
import { supabase } from '@/lib/supabase';
import { siloSocket } from '@/services/websocket';
import SiloMap from '@/components/SiloMapRectangle';
import SiloMapCircle from '@/components/SilomapCircle';

// ── Types ───────────────────────────────────────────────────
type HeatPoint = { x: number; y: number; z: number; temp: number; humidity: number };
type SensorRecord = {
  id: number;
  temperature: number | null;
  humidity: number | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
};
type Cell = {
  id: string;
  hangar_id: string;
  index_x: number;
  index_y: number;
  status: string;
  last_visited_at: string | null;
  color?: string;       // 'green' | 'yellow' | 'red' — from server cell_updated
  avg_temp?: number;
  avg_humidity?: number;
};
type Hangar = { id: string; shape?: 'circle' | 'rectangle'; width: number; height: number; diameter?: number; starting_cell_id?: string | null };
const SURFACE_Y = 2.9;
const CELL_SIZE_METERS = 0.2;

function toSurfacePoints(records: SensorRecord[]): HeatPoint[] {
  if (!records.length) return [{ x: 0, y: SURFACE_Y, z: 0, temp: 25, humidity: 45 }];
  return records.map((r) => ({
    x: (Number(r.longitude) || 0) * 2,
    y: SURFACE_Y,
    z: (Number(r.latitude) || 0) * 2,
    temp: Number(r.temperature) || 0,
    humidity: Number(r.humidity) || 0,
  }));
}

function getTempStatus(temp: number): { label: string; color: string } {
  if (temp > 35) return { label: 'High', color: '#EA575F' };
  if (temp > 28) return { label: 'Warm', color: '#FFA500' };
  return { label: 'Safe', color: '#4CAF50' };
}

export default function RobotScreen() {
  const insets = useSafeAreaInsets();
  const [points, setPoints] = useState<HeatPoint[]>([]);
  const [cells, setCells] = useState<Cell[]>([]);
  const [hangar, setHangar] = useState<Hangar | null>(null);
  const [startingCellId, setStartingCellId] = useState<string | null>(null);
  const [promptVisible, setPromptVisible] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const latestTemp = useMemo(
    () => (points.length > 0 ? points[points.length - 1].temp : 0),
    [points]
  );

  const completedCount = cells.filter((c) => c.status === 'completed').length;
  const progressPct =
    cells.length > 0 ? Math.round((completedCount / cells.length) * 100) : 0;

  // Fetch hangar and cells from DB
  useEffect(() => {
    const loadHangarAndCells = async () => {
      const { data: hData } = await supabase
        .from('hangars')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (!hData) return;
      setHangar(hData);

      const { data: cData } = await supabase
        .from('cells')
        .select('*')
        .eq('hangar_id', hData.id)
        .order('index_y', { ascending: true })
        .order('index_x', { ascending: true });
      if (cData) setCells(cData);
      if (hData.starting_cell_id) setStartingCellId(hData.starting_cell_id);
    };

    loadHangarAndCells();

    const sub = supabase
      .channel('cell-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cells' },
        (payload) => {
          setCells((current) =>
            current.map((c) =>
              c.id === payload.new.id ? { ...c, status: payload.new.status } : c
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, []);

  // DB polling
  useEffect(() => {
    let mounted = true;

    const loadLatestFromDb = async () => {
      const { data, error } = await supabase
        .from('sensor_data')
        .select('id, temperature, humidity, latitude, longitude, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error || !mounted || !data) return;
      setPoints(toSurfacePoints([...data].reverse()));
    };

    loadLatestFromDb();
    const id = setInterval(loadLatestFromDb, 5000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  // WebSocket stream
  useEffect(() => {
    siloSocket.connect();

    const off = siloSocket.onSensorData((data: any) => {
      // 1. Live Heat Map Points
      if (data.type === 'sensor_data' || data.temperature !== undefined) {
        const livePoint = toSurfacePoints([
          {
            id: Date.now(),
            temperature: Number(data.temperature ?? data.temp) || 0,
            humidity: Number(data.humidity ?? data.moisture) || 0,
            latitude: Number(data.latitude ?? data.y) || 0,
            longitude: Number(data.longitude ?? data.x) || 0,
            created_at: new Date().toISOString(),
          },
        ])[0];
        setPoints((current) => [...current.slice(-149), livePoint]);
      }

      // 2. Real-time Cell status (Real-time path painting)
      if (data.type === 'cell_updated') {
        const { x, y, status, color, avg_temp, avg_humidity } = data;
        setCells((current) =>
          current.map((c) =>
            c.index_x === x && c.index_y === y
              ? { ...c, status, color, avg_temp, avg_humidity }
              : c
          )
        );
      }

      // 3. Mission complete notification
      if (data.type === 'mission_complete') {
        Alert.alert('Mission Complete', '✅ All cells have been scanned!');
      }
    });

    return () => off();
  }, []);

  const tempStatus = getTempStatus(latestTemp);

  const saveStartingPosition = async (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim());
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    if (isNaN(x) || isNaN(y)) {
      Alert.alert('Invalid input', 'Enter coordinates as "x,y" e.g. 3,5');
      return;
    }
    const cell = cells.find((c) => c.index_x === x && c.index_y === y);
    if (!cell) {
      Alert.alert('Cell not found', `No cell at X: ${x}, Y: ${y}.`);
      return;
    }
    if (!hangar) return;
    const { error } = await supabase
      .from('hangars')
      .update({ starting_cell_id: cell.id })
      .eq('id', hangar.id);
    if (error) { Alert.alert('Error', error.message); return; }
    setStartingCellId(cell.id);
  };

  const promptStartingPosition = () => {
    const current = (() => {
      const c = cells.find((c) => c.id === startingCellId);
      return c ? `${c.index_x},${c.index_y}` : '';
    })();
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Set Starting Position',
        'Enter cell coordinates as x,y (e.g. 3,5)',
        (value) => { if (value) saveStartingPosition(value); },
        'plain-text',
        current,
        'numbers-and-punctuation',
      );
    } else {
      setPromptText(current);
      setPromptVisible(true);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Dynamic title from hangar ID */}
      <Stack.Screen options={{ title: hangar?.id ?? 'Robot' }} />
      {Platform.OS === 'android' && <BlurHeader title={hangar?.id ?? 'Robot'} />}

      {/* Android coordinate prompt modal */}
      <Modal
        visible={promptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPromptVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPromptVisible(false)}>
          <KeyboardAvoidingView behavior="padding">
            <Pressable style={styles.modalCard} onPress={() => { }}>
              <Text style={styles.modalTitle}>Set Starting Position</Text>
              <Text style={styles.modalSubtitle}>Enter cell coordinates as x,y (e.g. 3,5)</Text>
              <TextInput
                style={styles.modalInput}
                value={promptText}
                onChangeText={setPromptText}
                keyboardType="numbers-and-punctuation"
                autoFocus
                placeholder="x,y"
                placeholderTextColor="#555"
              />
              <View style={styles.modalBtns}>
                <Pressable style={styles.modalCancel} onPress={() => setPromptVisible(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={styles.modalConfirm}
                  onPress={() => {
                    setPromptVisible(false);
                    if (promptText) saveStartingPosition(promptText);
                  }}
                >
                  <Text style={styles.modalConfirmText}>Confirm</Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <ScrollView
        scrollEnabled={scrollEnabled}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: Platform.OS === 'android' ? 140 : insets.top + 70 },
        ]}
      >
        {/* Main card */}
        <View style={styles.card}>
          {/* Badge row */}
          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>✈ In Progress</Text>
            </View>
            <Text style={styles.coverageText}>Coverage: {progressPct}%</Text>
          </View>

          <View style={styles.divider} />

          {/* Heat map */}
          <View
            onTouchStart={() => setScrollEnabled(false)}
            onTouchEnd={() => setScrollEnabled(true)}
            onTouchCancel={() => setScrollEnabled(true)}
          >
            {hangar?.shape === 'circle' ? (
              <SiloMapCircle points={points} cells={cells} hangar={hangar} startingCellId={startingCellId} />
            ) : (
              <SiloMap points={points} cells={cells} hangar={hangar} startingCellId={startingCellId} />
            )}
          </View>

          {/* Starting Position button */}
          {cells.length > 0 && (
            <TouchableOpacity
              style={styles.startPosBtn}
              onPress={promptStartingPosition}
            >
              <Text style={styles.startPosBtnText}>
                {startingCellId
                  ? ` Starting Cell Set`
                  : ' Set Starting Position'}
              </Text>
              {startingCellId && (
                <Text style={styles.startPosSubText}>
                  {(() => {
                    const c = cells.find((c) => c.id === startingCellId);
                    return c ? `X: ${c.index_x}  Y: ${c.index_y}` : '';
                  })()}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* Generate grid button */}
          {hangar && cells.length === 0 && (
            <View style={styles.generateContainer}>
              <Text style={styles.generateHint}>
                No cells found. Generate the 20×20 cm grid to begin.
              </Text>
              <TouchableOpacity
                style={styles.generateBtn}
                onPress={async () => {
                  const w = hangar.width || 10;
                  const h = hangar.height || 10;
                  const cols = Math.ceil(w / CELL_SIZE_METERS);
                  const rows = Math.ceil(h / CELL_SIZE_METERS);
                  const newCells: any[] = [];
                  for (let y = 0; y < rows; y++)
                    for (let x = 0; x < cols; x++)
                      newCells.push({
                        hangar_id: hangar.id,
                        index_x: x,
                        index_y: y,
                        status: 'pending',
                      });
                  await supabase.from('cells').insert(newCells);
                  const { data: cData } = await supabase
                    .from('cells')
                    .select('*')
                    .eq('hangar_id', hangar.id);
                  if (cData) setCells(cData);
                }}
              >
                <Text style={styles.generateBtnText}>Generate Grid</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Stat cards */}
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Avg. Temp</Text>
            <Text style={[styles.statValue, { color: tempStatus.color }]}>
              {(latestTemp ?? 0).toFixed(1)}°C
            </Text>
            <Text style={[styles.statSub, { color: tempStatus.color }]}>
              {tempStatus.label}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Avg. Humidity</Text>
            <Text style={styles.statValue}>
              {points.length > 0 ? (points[points.length - 1].humidity ?? 0).toFixed(0) : "0"}%
            </Text>
            <Text style={styles.statSub}>Relative Humidity</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Air Quality</Text>
            <Text style={styles.statValue}>—</Text>
            <Text style={styles.statSub}>N/A</Text>
          </View>
        </View>

        {/* Control Deck */}
        <View style={styles.controlCard}>
          <Text style={styles.controlTitle}>Control Deck</Text>
          <View style={styles.controlRow}>
            <TouchableOpacity style={styles.deployBtn} onPress={() => { siloSocket.sendCommand('deploy'); Alert.alert('Command Sent', 'Deploy instruction sent to the robot.'); }}>
              <Text style={styles.deployBtnText}>Deploy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.recallBtn} onPress={() => { siloSocket.sendCommand('recall'); Alert.alert('Command Sent', 'Recall/Stop instruction sent to the robot.'); }}>
              <Text style={styles.recallBtnText}>Recall</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },

  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },

  // Main card
  card: {
    backgroundColor: '#141414',
    borderRadius: 26,
    padding: 18,
    gap: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  coverageText: { color: '#8E8E93', fontSize: 13 },
  divider: { height: 1, backgroundColor: '#2C2C2E' },

  // Generate grid
  generateContainer: { alignItems: 'center', gap: 12, paddingTop: 8 },
  generateHint: { color: '#8E8E93', fontSize: 13, textAlign: 'center' },
  generateBtn: {
    backgroundColor: '#EA575F',
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  generateBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Stat cards
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: '#141414',
    borderRadius: 20,
    padding: 14,
    gap: 4,
  },
  statLabel: { color: '#8E8E93', fontSize: 11 },
  statValue: { color: '#fff', fontSize: 20, fontWeight: '700' },
  statSub: { color: '#8E8E93', fontSize: 11 },

  // Control deck
  controlCard: {
    backgroundColor: '#141414',
    borderRadius: 26,
    padding: 18,
    gap: 14,
  },
  controlTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  controlRow: { flexDirection: 'row', gap: 12 },
  deployBtn: {
    flex: 1,
    backgroundColor: '#EA575F',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  deployBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
  recallBtn: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  recallBtnText: { color: '#8E8E93', fontSize: 16, fontWeight: '600' },

  // Android prompt modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    gap: 12,
  },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  modalSubtitle: { color: '#8E8E93', fontSize: 13 },
  modalInput: {
    backgroundColor: '#2C2C2E',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 16,
    marginTop: 4,
  },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 4 },
  modalCancel: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalCancelText: { color: '#8E8E93', fontWeight: '600', fontSize: 15 },
  modalConfirm: {
    flex: 1,
    backgroundColor: '#EA575F',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Starting position button
  startPosBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  startPosBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  startPosSubText: { color: '#EA575F', fontSize: 12, fontWeight: '500' },
});
