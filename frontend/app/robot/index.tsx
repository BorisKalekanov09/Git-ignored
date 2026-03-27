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
import SiloMapCircle from '@/components/SiloMapCircle';

// ── Types ───────────────────────────────────────────────────
type HeatPoint = { x: number; y: number; z: number; temp: number; humidity: number; airQuality: number; airDigital: number };
type SensorRecord = {
  id: number;
  temperature: number | null;
  humidity: number | null;
  latitude: number | null;
  longitude: number | null;
  air_quality: number | null;
  air_digital: number | null;
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
  avg_air_quality?: number;
};
type Hangar = { id: string; shape?: 'circle' | 'rectangle'; width: number; height: number; diameter?: number; starting_cell_id?: string | null };
const SURFACE_Y = 2.9;
const CELL_SIZE_METERS = 0.2;

function toSurfacePoints(records: SensorRecord[]): HeatPoint[] {
  return records.map((r) => ({
    x: (Number(r.longitude) || 0) * 0.01, 
    y: SURFACE_Y,
    z: (Number(r.latitude) || 0) * 0.01,
    temp: Number(r.temperature) || 0,
    humidity: Number(r.humidity) || 0,
    airQuality: Number(r.air_quality) || 0,
    airDigital: Number(r.air_digital) || 0,
  }));
}

function getAirStatus(score: number, digital: number): { label: string; color: string } {
  if (digital === 0) return { label: 'Danger', color: '#EA575F' }; // Assuming active low for MQ sensors
  if (score > 2000) return { label: 'Poor', color: '#FFA500' };
  return { label: 'Fresh', color: '#4CAF50' };
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
  const [isDeployed, setIsDeployed] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const deploymentIdRef = useRef<string | null>(null);
  const [resizeVisible, setResizeVisible] = useState(false);
  const [newWidth, setNewWidth] = useState('');
  const [newHeight, setNewHeight] = useState('');

  // Compute averages from visited cells (avg_* fields set by server after each cell_complete)
  const avgTemp = useMemo(() => {
    const visited = cells.filter(c => c.avg_temp != null);
    if (!visited.length) return 0;
    return visited.reduce((s, c) => s + (c.avg_temp ?? 0), 0) / visited.length;
  }, [cells]);

  const avgHumidity = useMemo(() => {
    const visited = cells.filter(c => c.avg_humidity != null);
    if (!visited.length) return 0;
    return visited.reduce((s, c) => s + (c.avg_humidity ?? 0), 0) / visited.length;
  }, [cells]);

  const avgAirQuality = useMemo(() => {
    const visited = cells.filter(c => c.avg_air_quality != null);
    if (!visited.length) return 0;
    return visited.reduce((s, c) => s + (c.avg_air_quality ?? 0), 0) / visited.length;
  }, [cells]);

  const visitedCount = cells.filter((c) => c.status !== 'pending').length;
  const progressPct = cells.length > 0 ? Math.round((visitedCount / cells.length) * 100) : 0;

  // Auto-reset to idle when 100% coverage is reached
  useEffect(() => {
    if (progressPct === 100 && isDeployed && cells.length > 0) {
      setIsDeployed(false);
      if (deploymentIdRef.current) {
        supabase.from('deployments')
          .update({ status: 'completed', ended_at: new Date().toISOString() })
          .eq('id', deploymentIdRef.current);
        deploymentIdRef.current = null;
        setDeploymentId(null);
      }
    }
  }, [progressPct, isDeployed, cells.length]);

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

      // Load active deployment
      const { data: dData } = await supabase
        .from('deployments')
        .select('id')
        .eq('hangar_id', hData.id)
        .eq('status', 'active')
        .maybeSingle();
      if (dData) {
        setDeploymentId(dData.id);
        deploymentIdRef.current = dData.id;
        setIsDeployed(true);
      }
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
              c.id === payload.new.id
                ? {
                    ...c,
                    status: payload.new.status,
                    avg_temp: payload.new.avg_temp ?? c.avg_temp,
                    avg_humidity: payload.new.avg_humidity ?? c.avg_humidity,
                    avg_air_quality: payload.new.avg_air_quality ?? c.avg_air_quality,
                    last_visited_at: payload.new.last_visited_at,
                  }
                : c
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
        .select('id, temperature, humidity, air_quality, air_digital, latitude, longitude, created_at')
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
            air_quality: Number(data.air_quality) || 0,
            air_digital: Number(data.air_digital) ?? 1,
            created_at: new Date().toISOString(),
          },
        ])[0];
        setPoints((current) => [...current.slice(-149), livePoint]);
      }

      // 2. Real-time Cell status (Real-time path painting)
      if (data.type === 'cell_updated') {
        const { x, y, status, color, avg_temp, avg_humidity, avg_air_quality } = data;
        setCells((current) =>
          current.map((c) =>
            c.index_x === x && c.index_y === y
              ? { ...c, status, color, avg_temp, avg_humidity, avg_air_quality }
              : c
          )
        );
      }

      // 3. Mission complete notification
      if (data.type === 'mission_complete') {
        Alert.alert('Mission Complete', 'All cells have been scanned!');
        if (deploymentIdRef.current) {
          supabase.from('deployments')
            .update({ status: 'completed', ended_at: new Date().toISOString() })
            .eq('id', deploymentIdRef.current);
        }
        setIsDeployed(false);
        setDeploymentId(null);
        deploymentIdRef.current = null;
      }
    });

    return () => off();
  }, []);

  const tempStatus = getTempStatus(avgTemp);
  const airStatus = getAirStatus(avgAirQuality, 1);

  const handleDeploy = async () => {
    if (!hangar) return;
    const { data: dep, error: depErr } = await supabase
      .from('deployments')
      .insert({ hangar_id: hangar.id, status: 'active', started_at: new Date().toISOString() })
      .select('id')
      .single();
    if (depErr) { Alert.alert('Error', depErr.message); return; }
    // Reset all cells to pending so the trail starts fresh
    await supabase
      .from('cells')
      .update({ status: 'pending', avg_temp: null, avg_humidity: null, avg_air_quality: null, last_visited_at: null })
      .eq('hangar_id', hangar.id);
    setCells(prev => prev.map(c => ({ ...c, status: 'pending', avg_temp: undefined, avg_humidity: undefined })));
    setDeploymentId(dep.id);
    deploymentIdRef.current = dep.id;
    setIsDeployed(true);
    siloSocket.sendCommand('deploy');
    Alert.alert('Deployed', 'Robot deployed. Trail will appear as cells are visited.');
  };

  const handleRecall = async () => {
    siloSocket.sendCommand('recall');
    if (deploymentIdRef.current) {
      await supabase.from('deployments')
        .update({ status: 'recalled', ended_at: new Date().toISOString() })
        .eq('id', deploymentIdRef.current);
    }
    setIsDeployed(false);
    setDeploymentId(null);
    deploymentIdRef.current = null;
    Alert.alert('Recalled', 'Robot has been recalled.');
  };

  const handleResize = async (widthStr = newWidth, heightStr = newHeight) => {
    const w = parseFloat(widthStr);
    const h = parseFloat(heightStr);
    if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
      Alert.alert('Invalid dimensions', 'Enter valid width and height in metres.');
      return;
    }
    if (!hangar) return;
    await supabase.from('hangars').update({ width: w, height: h }).eq('id', hangar.id);
    await supabase.from('cells').delete().eq('hangar_id', hangar.id);
    const cellSize = 0.2;
    const cols = Math.ceil(w / cellSize);
    const rows = Math.ceil(h / cellSize);
    const newCells: any[] = [];
    for (let iy = 0; iy < rows; iy++)
      for (let ix = 0; ix < cols; ix++)
        newCells.push({ hangar_id: hangar.id, index_x: ix, index_y: iy, status: 'pending' });
    await supabase.from('cells').insert(newCells);
    setHangar(prev => prev ? { ...prev, width: w, height: h } : prev);
    const { data: cData } = await supabase.from('cells').select('*').eq('hangar_id', hangar.id)
      .order('index_y', { ascending: true }).order('index_x', { ascending: true });
    if (cData) setCells(cData);
    setResizeVisible(false);
  };

  const promptResize = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Resize Hangar',
        'Enter new width in metres',
        (widthStr) => {
          if (!widthStr) return;
          Alert.prompt(
            'Resize Hangar',
            'Enter new height in metres',
            (heightStr) => { if (heightStr) handleResize(widthStr, heightStr); },
            'plain-text',
            hangar ? String(hangar.height ?? '') : '',
            'decimal-pad',
          );
        },
        'plain-text',
        hangar ? String(hangar.width ?? '') : '',
        'decimal-pad',
      );
    } else {
      setNewWidth(hangar ? String(hangar.width ?? '') : '');
      setNewHeight(hangar ? String(hangar.height ?? '') : '');
      setResizeVisible(true);
    }
  };

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

      {/* Resize Hangar Modal */}
      <Modal
        visible={resizeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setResizeVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setResizeVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Resize Hangar</Text>
              <Text style={styles.modalSubtitle}>New dimensions in metres. Grid will be regenerated.</Text>
              <TextInput
                style={styles.modalInput}
                value={newWidth}
                onChangeText={setNewWidth}
                keyboardType="decimal-pad"
                placeholder="Width (m)"
                placeholderTextColor="#555"
              />
              <TextInput
                style={[styles.modalInput, { marginTop: 10 }]}
                value={newHeight}
                onChangeText={setNewHeight}
                keyboardType="decimal-pad"
                placeholder="Height (m)"
                placeholderTextColor="#555"
              />
              <View style={styles.modalBtns}>
                <Pressable style={styles.modalCancel} onPress={() => setResizeVisible(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.modalConfirm} onPress={() => handleResize()}>
                  <Text style={styles.modalConfirmText}>Apply</Text>
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
              <Text style={styles.badgeText}>{isDeployed ? '▶ Deployed' : 'Idle'}</Text>
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

          {/* Resize Hangar button */}
          {hangar && (
            <TouchableOpacity
              style={styles.resizeBtn}
              onPress={promptResize}
            >
              <Text style={styles.resizeBtnText}>⤡  Resize Hangar</Text>
            </TouchableOpacity>
          )}

          {/* Starting Position button — disabled during deployment */}
          {cells.length > 0 && (
            <TouchableOpacity
              style={[styles.startPosBtn, isDeployed && { opacity: 0.4 }]}
              onPress={isDeployed ? undefined : promptStartingPosition}
              activeOpacity={isDeployed ? 1 : 0.7}
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
              {avgTemp > 0 ? avgTemp.toFixed(1) : '—'}°C
            </Text>
            <Text style={[styles.statSub, { color: tempStatus.color }]}>
              {tempStatus.label}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Avg. Humidity</Text>
            <Text style={[styles.statValue, { color: avgHumidity > 85 ? '#EA575F' : avgHumidity > 70 ? '#FFA500' : avgHumidity > 0 ? '#4CAF50' : '#8E8E93' }]}>
              {avgHumidity > 0 ? avgHumidity.toFixed(0) : '—'}%
            </Text>
            <Text style={styles.statSub}>Relative Humidity</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Air Quality</Text>
            <Text style={[styles.statValue, { color: airStatus.color }]}>
              {avgAirQuality > 0 ? avgAirQuality.toFixed(0) : '—'}
            </Text>
            <Text style={[styles.statSub, { color: airStatus.color }]}>
              {airStatus.label}
            </Text>
          </View>
        </View>

        {/* Control Deck */}
        <View style={styles.controlCard}>
          <Text style={styles.controlTitle}>Control Deck</Text>
          <View style={styles.controlRow}>
            <TouchableOpacity
              style={[styles.deployBtn, isDeployed && { opacity: 0.4 }]}
              onPress={handleDeploy}
              disabled={isDeployed}
            >
              <Text style={styles.deployBtnText}>Deploy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.recallBtn, !isDeployed && { opacity: 0.4 }]}
              onPress={handleRecall}
              disabled={!isDeployed}
            >
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

  // Resize button
  resizeBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 11,
    alignItems: 'center',
  },
  resizeBtnText: { color: '#8E8E93', fontSize: 13, fontWeight: '500' },
});
