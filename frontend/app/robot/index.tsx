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
let _pointCounter = 0; // monotonic ID — avoids Date.now() collisions

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

type SessionSummary = {
  duration: string;
  avgTemp: number;
  maxTemp: number;
  avgHumidity: number;
  avgAQ: number;
  maxAQ: number;
  cellsVisited: number;
  totalCells: number;
  efficiency: string;
};

function buildSummary(cells: Cell[], deployStartMs: number | null): SessionSummary {
  const visited = cells.filter(c => c.status !== 'pending');
  const temps = visited.filter(c => c.avg_temp != null).map(c => c.avg_temp!);
  const hums  = visited.filter(c => c.avg_humidity != null).map(c => c.avg_humidity!);
  const aqs   = visited.filter(c => c.avg_air_quality != null).map(c => c.avg_air_quality!);
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const durationMs = deployStartMs ? Date.now() - deployStartMs : 0;
  const totalMin = durationMs / 60000;
  const mins = Math.floor(totalMin);
  const secs = Math.round((totalMin - mins) * 60);
  return {
    duration: `${mins}m ${secs}s`,
    avgTemp: avg(temps),
    maxTemp: temps.length ? Math.max(...temps) : 0,
    avgHumidity: avg(hums),
    avgAQ: avg(aqs),
    maxAQ: aqs.length ? Math.max(...aqs) : 0,
    cellsVisited: visited.length,
    totalCells: cells.length,
    efficiency: totalMin > 0 ? (visited.length / totalMin).toFixed(1) : '—',
  };
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
  const [newDiameter, setNewDiameter] = useState('');
  const [aqDetailVisible, setAqDetailVisible] = useState(false);
  const [tempDetailVisible, setTempDetailVisible] = useState(false);
  const [humDetailVisible, setHumDetailVisible] = useState(false);
  const [hideWarnings, setHideWarnings] = useState(false);
  const [dangerLog, setDangerLog] = useState<{ time: string; message: string; color: string }[]>([]);
  const deployStartRef = useRef<number | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [liveSensor, setLiveSensor] = useState<{ temp: number; hum: number; air: number } | null>(null);

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
      const summary = buildSummary(cells, deployStartRef.current);
      setSessionSummary(summary);
      setSummaryVisible(true);
      setIsDeployed(false);
      if (deploymentIdRef.current) {
        supabase.from('deployments')
          .update({ status: 'completed', ended_at: new Date().toISOString() })
          .eq('id', deploymentIdRef.current);
        deploymentIdRef.current = null;
        setDeploymentId(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressPct, isDeployed, cells.length]);

  // Fetch hangar and cells from DB
  useEffect(() => {
    const loadHangarAndCells = async () => {
      const { data: hData } = await supabase
        .from('hangars')
        .select('*')
        .order('created_at', { ascending: false })
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
    return () => { mounted = false; };
  }, []);

  // WebSocket stream
  useEffect(() => {
    siloSocket.connect();

    const off = siloSocket.onSensorData((data: any) => {
      // 1. Live Heat Map Points + live stat tracking
      if (data.type === 'sensor_data' || data.temperature !== undefined) {
        // Update live readings for stat cards
        const liveT = Number(data.temperature ?? data.temp);
        const liveH = Number(data.humidity ?? data.moisture);
        const liveA = Number(data.air_quality);
        if (!isNaN(liveT) && liveT > 0) {
          setLiveSensor({ temp: liveT, hum: liveH, air: liveA });
        }
        const livePoint = toSurfacePoints([
          {
            id: _pointCounter++,
            temperature: liveT || 0,
            humidity: liveH || 0,
            latitude: Number(data.latitude ?? data.y) || 0,
            longitude: Number(data.longitude ?? data.x) || 0,
            air_quality: liveA || 0,
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
        // Append to danger / warning log
        if (color === 'red' || color === 'yellow') {
          const reasons: string[] = [];
          if ((avg_temp ?? 0) > 35)       reasons.push(`Temp ${(avg_temp ?? 0).toFixed(1)}°C`);
          else if ((avg_temp ?? 0) > 28)  reasons.push(`Warm ${(avg_temp ?? 0).toFixed(1)}°C`);
          if ((avg_humidity ?? 0) > 85)   reasons.push(`Humidity ${(avg_humidity ?? 0).toFixed(0)}%`);
          else if ((avg_humidity ?? 0) > 70) reasons.push(`Humidity ${(avg_humidity ?? 0).toFixed(0)}%`);
          if ((avg_air_quality ?? 0) > 3000)      reasons.push(`Air ${(avg_air_quality ?? 0).toFixed(0)} ppm`);
          else if ((avg_air_quality ?? 0) > 2000) reasons.push(`Air ${(avg_air_quality ?? 0).toFixed(0)} ppm`);
          if (reasons.length > 0) {
            const logColor = color === 'red' ? '#EA575F' : '#FFA500';
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setDangerLog(prev => [
              { time, message: `${color === 'red' ? 'Danger' : 'Warning'}: ${reasons.join(', ')} — Cell (${x},${y})`, color: logColor },
              ...prev,
            ].slice(0, 30));
          }
        }
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

      // Backend confirmation that recall was processed
      if (data.type === 'mission_status' && data.status === 'stopped') {
        setIsDeployed(false);
        setDeploymentId(null);
        deploymentIdRef.current = null;
      }
    });

    return () => off();
  }, []);

  const cellAvgTemp = useMemo(() => {
    const visited = cells.filter(c => c.avg_temp != null && (c.avg_temp ?? 0) > 0);
    if (!visited.length) return null;
    return visited.reduce((s, c) => s + (c.avg_temp ?? 0), 0) / visited.length;
  }, [cells]);

  const cellAvgHum = useMemo(() => {
    const visited = cells.filter(c => c.avg_humidity != null && (c.avg_humidity ?? 0) > 0);
    if (!visited.length) return null;
    return visited.reduce((s, c) => s + (c.avg_humidity ?? 0), 0) / visited.length;
  }, [cells]);

  const cellAvgAir = useMemo(() => {
    const visited = cells.filter(c => c.avg_air_quality != null && (c.avg_air_quality ?? 0) > 0);
    if (!visited.length) return null;
    return visited.reduce((s, c) => s + (c.avg_air_quality ?? 0), 0) / visited.length;
  }, [cells]);

  // Use cell averages if available, otherwise fall back to live sensor reading
  const displayTemp = cellAvgTemp ?? liveSensor?.temp ?? 0;
  const displayHum  = cellAvgHum  ?? liveSensor?.hum  ?? 0;
  const displayAir  = cellAvgAir  ?? liveSensor?.air  ?? 0;

  const tempStatus = getTempStatus(displayTemp);
  const airStatus = getAirStatus(displayAir, 1);
  const isLiveOnly = cellAvgTemp === null;

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
    deployStartRef.current = Date.now();
    setDangerLog([]);
    setIsDeployed(true);
    // Send hangar_id and coordinates to ensure backend uses the correct hangar
    const startCell = cells.find(c => c.id === startingCellId);
    siloSocket.sendCommand('deploy', {
      hangar_id: hangar?.id,
      ...(startCell ? { starting_x: startCell.index_x, starting_y: startCell.index_y } : {})
    });
    Alert.alert('Deployed', 'Robot deployed. Trail will appear as cells are visited.');
  };

  const handleRecall = async () => {
    const summary = buildSummary(cells, deployStartRef.current);
    setSessionSummary(summary);
    setSummaryVisible(true);
    siloSocket.sendCommand('recall');
    if (deploymentIdRef.current) {
      await supabase.from('deployments')
        .update({ status: 'recalled', ended_at: new Date().toISOString() })
        .eq('id', deploymentIdRef.current);
    }
    setIsDeployed(false);
    setDeploymentId(null);
    deploymentIdRef.current = null;
  };

  const handleResize = async (dimA = newWidth, dimB = newHeight, diamStr = newDiameter) => {
    if (!hangar) return;
    const cellSize = 0.2;
    const newCells: any[] = [];

    if (hangar.shape === 'circle') {
      const d = parseFloat(diamStr);
      if (isNaN(d) || d <= 0) {
        Alert.alert('Invalid dimension', 'Enter a valid diameter in metres.');
        return;
      }
      await supabase.from('hangars').update({ diameter: d }).eq('id', hangar.id);
      await supabase.from('cells').delete().eq('hangar_id', hangar.id);
      const n = Math.ceil(d / cellSize);
      for (let iy = 0; iy < n; iy++)
        for (let ix = 0; ix < n; ix++)
          newCells.push({ hangar_id: hangar.id, index_x: ix, index_y: iy, status: 'pending' });
      const { error: insErr1 } = await supabase.from('cells').insert(newCells);
      if (insErr1) { Alert.alert('Error', 'Failed to regenerate grid.'); setResizeVisible(false); return; }
      setHangar(prev => prev ? { ...prev, diameter: d } : prev);
    } else {
      const w = parseFloat(dimA);
      const h = parseFloat(dimB);
      if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
        Alert.alert('Invalid dimensions', 'Enter valid width and height in metres.');
        return;
      }
      await supabase.from('hangars').update({ width: w, height: h }).eq('id', hangar.id);
      await supabase.from('cells').delete().eq('hangar_id', hangar.id);
      const cols = Math.ceil(w / cellSize);
      const rows = Math.ceil(h / cellSize);
      for (let iy = 0; iy < rows; iy++)
        for (let ix = 0; ix < cols; ix++)
          newCells.push({ hangar_id: hangar.id, index_x: ix, index_y: iy, status: 'pending' });
      const { error: insErr2 } = await supabase.from('cells').insert(newCells);
      if (insErr2) { Alert.alert('Error', 'Failed to regenerate grid.'); setResizeVisible(false); return; }
      setHangar(prev => prev ? { ...prev, width: w, height: h } : prev);
    }

    const { data: cData } = await supabase.from('cells').select('*').eq('hangar_id', hangar.id)
      .order('index_y', { ascending: true }).order('index_x', { ascending: true });
    if (cData) setCells(cData);
    setResizeVisible(false);
  };

  const promptResize = () => {
    if (hangar?.shape === 'circle') {
      if (Platform.OS === 'ios') {
        Alert.prompt(
          'Resize Silo',
          'Enter new diameter in metres',
          (diamStr) => { if (diamStr) handleResize('', '', diamStr); },
          'plain-text',
          hangar ? String(hangar.diameter ?? '') : '',
          'decimal-pad',
        );
      } else {
        setNewDiameter(hangar ? String(hangar.diameter ?? '') : '');
        setResizeVisible(true);
      }
    } else {
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
    }
  };

  const saveStartingPosition = async (raw: string) => {
    const parts = raw.split(',').map((s) => s.trim());
    if (parts.length !== 2) {
      Alert.alert('Invalid format', 'Enter position as "x,y" e.g. 3,5');
      return;
    }
    const x = parseInt(parts[0], 10);
    const y = parseInt(parts[1], 10);
    if (isNaN(x) || isNaN(y) || x < 0 || y < 0) {
      Alert.alert('Invalid input', 'x and y must be non-negative integers.');
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

      {/* Temperature Detail Modal */}
      <Modal
        visible={tempDetailVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTempDetailVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setTempDetailVisible(false)}>
          <Pressable style={[styles.modalCard, { gap: 14 }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Temperature</Text>
            <Text style={styles.modalSubtitle}>Average across all visited cells in this session.</Text>
            <View style={{ backgroundColor: '#0D0305', borderRadius: 16, padding: 16, alignItems: 'center', gap: 4 }}>
              <Text style={{ color: '#8E8E93', fontSize: 12 }}>Session Average</Text>
              <Text style={{ color: tempStatus.color, fontSize: 42, fontWeight: '700' }}>
                {avgTemp > 0 ? avgTemp.toFixed(1) : '—'}
              </Text>
              <Text style={{ color: tempStatus.color, fontSize: 14 }}>°C  ·  {tempStatus.label}</Text>
            </View>
            {([
              { range: '≤ 28°C', label: 'Safe', color: '#4CAF50' },
              { range: '28 – 35°C', label: 'Warm — Monitor', color: '#FFA500' },
              { range: '> 35°C', label: 'High — Risk of spoilage', color: '#EA575F' },
            ] as const).map(row => (
              <View key={row.range} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#2C2C2E' }}>
                <View style={[styles.alertDot, { backgroundColor: row.color }]} />
                <Text style={{ color: '#ccc', fontSize: 13, flex: 1 }}>{row.range}</Text>
                <Text style={{ color: row.color, fontSize: 13, fontWeight: '600' }}>{row.label}</Text>
              </View>
            ))}
            <Pressable style={[styles.modalConfirm, { marginTop: 4 }]} onPress={() => setTempDetailVisible(false)}>
              <Text style={styles.modalConfirmText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Humidity Detail Modal */}
      <Modal
        visible={humDetailVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHumDetailVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setHumDetailVisible(false)}>
          <Pressable style={[styles.modalCard, { gap: 14 }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Humidity</Text>
            <Text style={styles.modalSubtitle}>Relative humidity percentage measured at each cell.</Text>
            <View style={{ backgroundColor: '#0D0305', borderRadius: 16, padding: 16, alignItems: 'center', gap: 4 }}>
              <Text style={{ color: '#8E8E93', fontSize: 12 }}>Session Average</Text>
              <Text style={{ color: avgHumidity > 85 ? '#EA575F' : avgHumidity > 70 ? '#FFA500' : '#4CAF50', fontSize: 42, fontWeight: '700' }}>
                {avgHumidity > 0 ? avgHumidity.toFixed(0) : '—'}
              </Text>
              <Text style={{ color: avgHumidity > 85 ? '#EA575F' : avgHumidity > 70 ? '#FFA500' : '#4CAF50', fontSize: 14 }}>%  ·  {avgHumidity > 85 ? 'High' : avgHumidity > 70 ? 'Elevated' : 'Normal'}</Text>
            </View>
            {([
              { range: '≤ 70%', label: 'Normal', color: '#4CAF50' },
              { range: '70 – 85%', label: 'Elevated — Mould Risk', color: '#FFA500' },
              { range: '> 85%', label: 'High — Danger', color: '#EA575F' },
            ] as const).map(row => (
              <View key={row.range} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#2C2C2E' }}>
                <View style={[styles.alertDot, { backgroundColor: row.color }]} />
                <Text style={{ color: '#ccc', fontSize: 13, flex: 1 }}>{row.range}</Text>
                <Text style={{ color: row.color, fontSize: 13, fontWeight: '600' }}>{row.label}</Text>
              </View>
            ))}
            <Pressable style={[styles.modalConfirm, { marginTop: 4 }]} onPress={() => setHumDetailVisible(false)}>
              <Text style={styles.modalConfirmText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Air Quality Detail Modal */}
      <Modal
        visible={aqDetailVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAqDetailVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setAqDetailVisible(false)}>
          <Pressable style={[styles.modalCard, { gap: 14 }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Air Quality Index</Text>
            <Text style={styles.modalSubtitle}>Measured in ppm (parts per million) by the onboard gas sensor.</Text>
            {/* Current reading */}
            <View style={{ backgroundColor: '#0D0305', borderRadius: 16, padding: 16, alignItems: 'center', gap: 4 }}>
              <Text style={{ color: '#8E8E93', fontSize: 12 }}>Current Session Average</Text>
              <Text style={{ color: airStatus.color, fontSize: 42, fontWeight: '700' }}>
                {avgAirQuality > 0 ? avgAirQuality.toFixed(0) : '—'}
              </Text>
              <Text style={{ color: airStatus.color, fontSize: 14 }}>ppm  ·  {airStatus.label}</Text>
            </View>
            {/* Threshold table */}
            {([
              { range: '< 1000 ppm', label: 'Fresh Air', color: '#4CAF50' },
              { range: '1000 – 2000 ppm', label: 'Acceptable', color: '#8E8E93' },
              { range: '2000 – 3000 ppm', label: 'Poor — Drowsiness Risk', color: '#FFA500' },
              { range: '> 3000 ppm', label: 'Hazardous', color: '#EA575F' },
            ] as const).map(row => (
              <View key={row.range} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#2C2C2E' }}>
                <View style={[styles.alertDot, { backgroundColor: row.color }]} />
                <Text style={{ color: '#ccc', fontSize: 13, flex: 1 }}>{row.range}</Text>
                <Text style={{ color: row.color, fontSize: 13, fontWeight: '600' }}>{row.label}</Text>
              </View>
            ))}
            <Pressable style={[styles.modalConfirm, { marginTop: 4 }]} onPress={() => setAqDetailVisible(false)}>
              <Text style={styles.modalConfirmText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Session Summary Modal */}
      <Modal
        visible={summaryVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSummaryVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSummaryVisible(false)}>
          <Pressable style={[styles.modalCard, { gap: 12 }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Session Summary</Text>
            {sessionSummary && (
              <>
                {([
                  { label: 'Duration', value: sessionSummary.duration },
                  { label: 'Cells Covered', value: `${sessionSummary.cellsVisited} / ${sessionSummary.totalCells}` },
                  { label: 'Efficiency', value: `${sessionSummary.efficiency} cells/min` },
                  { label: 'Avg. Temp', value: sessionSummary.avgTemp > 0 ? `${sessionSummary.avgTemp.toFixed(1)}°C` : '—' },
                  { label: 'Max Temp', value: sessionSummary.maxTemp > 0 ? `${sessionSummary.maxTemp.toFixed(1)}°C` : '—',
                    color: sessionSummary.maxTemp > 35 ? '#EA575F' : sessionSummary.maxTemp > 28 ? '#FFA500' : '#4CAF50' },
                  { label: 'Avg. Humidity', value: sessionSummary.avgHumidity > 0 ? `${sessionSummary.avgHumidity.toFixed(0)}%` : '—' },
                  { label: 'Avg. Air Quality', value: sessionSummary.avgAQ > 0 ? `${sessionSummary.avgAQ.toFixed(0)} ppm` : '—' },
                  { label: 'Max Air Quality', value: sessionSummary.maxAQ > 0 ? `${sessionSummary.maxAQ.toFixed(0)} ppm` : '—',
                    color: sessionSummary.maxAQ > 3000 ? '#EA575F' : sessionSummary.maxAQ > 2000 ? '#FFA500' : '#4CAF50' },
                ] as { label: string; value: string; color?: string }[]).map(row => (
                  <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#2C2C2E' }}>
                    <Text style={{ color: '#8E8E93', fontSize: 14 }}>{row.label}</Text>
                    <Text style={{ color: row.color ?? '#fff', fontSize: 14, fontWeight: '600' }}>{row.value}</Text>
                  </View>
                ))}
              </>
            )}
            <Pressable style={[styles.modalConfirm, { marginTop: 4 }]} onPress={() => setSummaryVisible(false)}>
              <Text style={styles.modalConfirmText}>Done</Text>
            </Pressable>
          </Pressable>
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
              <Text style={styles.modalTitle}>Resize {hangar?.shape === 'circle' ? 'Silo' : 'Hangar'}</Text>
              <Text style={styles.modalSubtitle}>New dimensions in metres. Grid will be regenerated.</Text>
              {hangar?.shape === 'circle' ? (
                <TextInput
                  style={styles.modalInput}
                  value={newDiameter}
                  onChangeText={setNewDiameter}
                  keyboardType="decimal-pad"
                  placeholder="Diameter (m)"
                  placeholderTextColor="#555"
                />
              ) : (
                <>
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
                </>
              )}
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

          {/* Resize Hangar button — locked during deployment */}
          {hangar && (
            <TouchableOpacity
              style={[styles.resizeBtn, isDeployed && { opacity: 0.4 }]}
              onPress={isDeployed ? undefined : promptResize}
              disabled={isDeployed}
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
          <TouchableOpacity style={styles.statCard} activeOpacity={0.7} onPress={() => setTempDetailVisible(true)}>
            <Text style={styles.statLabel}>{isLiveOnly ? 'Live Temp' : 'Avg. Temp'}</Text>
            <Text style={[styles.statValue, { color: tempStatus.color }]}>
              {displayTemp > 0 ? displayTemp.toFixed(1) : '—'}°C
            </Text>
            <Text style={[styles.statSub, { color: tempStatus.color }]}>
              {tempStatus.label} ›
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard} activeOpacity={0.7} onPress={() => setHumDetailVisible(true)}>
            <Text style={styles.statLabel}>{isLiveOnly ? 'Live Humidity' : 'Avg. Humidity'}</Text>
            <Text style={[styles.statValue, { color: displayHum > 85 ? '#EA575F' : displayHum > 70 ? '#FFA500' : displayHum > 0 ? '#4CAF50' : '#8E8E93' }]}>
              {displayHum > 0 ? displayHum.toFixed(0) : '—'}%
            </Text>
            <Text style={[styles.statSub, { color: displayHum > 85 ? '#EA575F' : displayHum > 70 ? '#FFA500' : displayHum > 0 ? '#4CAF50' : '#8E8E93' }]}>
              {displayHum > 85 ? 'High ›' : displayHum > 70 ? 'Elevated ›' : displayHum > 0 ? 'Normal ›' : 'No data'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard} activeOpacity={0.7} onPress={() => setAqDetailVisible(true)}>
            <Text style={styles.statLabel}>{isLiveOnly ? 'Live Air' : 'Air Quality'}</Text>
            <Text style={[styles.statValue, { color: airStatus.color }]}>
              {displayAir > 0 ? displayAir.toFixed(0) : '—'}
            </Text>
            <Text style={[styles.statSub, { color: airStatus.color }]}>
              {airStatus.label} ›
            </Text>
          </TouchableOpacity>
        </View>

        {/* Danger / Warning Alert Log */}
        {dangerLog.length > 0 && (
          <View style={styles.alertsCard}>
            {/* Header row */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.controlTitle}>Alerts</Text>
              <TouchableOpacity
                onPress={() => setHideWarnings(h => !h)}
                style={{ backgroundColor: '#2C2C2E', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}
              >
                <Text style={{ color: hideWarnings ? '#FFA500' : '#8E8E93', fontSize: 12, fontWeight: '600' }}>
                  {hideWarnings ? 'Show Warnings' : 'Hide Warnings'}
                </Text>
              </TouchableOpacity>
            </View>
            {/* Fixed-height scrollable log */}
            <ScrollView
              style={{ maxHeight: 200 }}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {dangerLog
                .filter(e => !(hideWarnings && e.color === '#FFA500'))
                .map((entry, i) => (
                  <View key={i} style={[styles.alertRow, { marginBottom: 10 }]}>
                    <View style={[styles.alertDot, { backgroundColor: entry.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: entry.color, fontSize: 12, fontWeight: '600' }}>{entry.time}</Text>
                      <Text style={{ color: '#ccc', fontSize: 13 }}>{entry.message}</Text>
                    </View>
                  </View>
                ))}
            </ScrollView>
          </View>
        )}

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

  // Alerts log
  alertsCard: {
    backgroundColor: '#141414',
    borderRadius: 26,
    padding: 18,
    gap: 12,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  alertDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
  },

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
