// services/websocket.ts
import * as Constants from 'expo-constants';

// Multi-source fallback: env vars → app.json extra → hardcoded defaults
const getServerIP = () => {
  const envIP = process.env.EXPO_PUBLIC_SERVER_IP?.trim();
  if (envIP && envIP !== 'undefined') return envIP;

  try {
    const configIP = (Constants.default?.expoConfig as any)?.extra?.serverIP;
    if (configIP) return configIP;
  } catch (e) { }

  return '192.168.0.106'; // fallback
};

const getAuthKey = () => {
  const envKey = process.env.EXPO_PUBLIC_ESP32_AUTH_KEY?.trim();
  if (envKey && envKey !== 'undefined') return envKey;

  try {
    const configKey = (Constants.default?.expoConfig as any)?.extra?.authKey;
    if (configKey) return configKey;
  } catch (e) { }

  return null; // No fallback for security
};

const IP = getServerIP();
const KEY = getAuthKey();

const buildServerUrl = () => {
  if (!IP) return null;
  if (!KEY) return `ws://${IP}:8080`;
  return `ws://${IP}:8080?token=${encodeURIComponent(KEY)}`;
};

console.log("🌐 WebSocket - IP:", IP, "Auth Key present:", !!KEY);

let socket: WebSocket | null = null;
let listeners: ((data: any) => void)[] = [];
let retryDelay = 3000;
const MAX_RETRY_DELAY = 30000;

export const siloSocket = {
  connect: () => {
    const SERVER_URL = buildServerUrl();

    if (!SERVER_URL) {
      console.error("❌ Missing EXPO_PUBLIC_SERVER_IP in frontend/.env");
      return;
    }

    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    )
      return;

    socket = new WebSocket(SERVER_URL);

    socket.onopen = () => {
      console.log("🚀 Connected to:", SERVER_URL);
      retryDelay = 3000; // reset backoff on successful connection
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        // Forward all relevant message types to listeners
        const forwarded = new Set(["sensor_data", "cell_updated", "mission_complete", "mission_error", "goto", "mission_status"]);
        if (forwarded.has(message.type)) {
          listeners.forEach((callback) => callback(message.data ?? message));
        }
      } catch (e) {
        console.error("WS Parse Error", e);
      }
    };

    socket.onerror = () => console.warn(`WS: could not connect to ${SERVER_URL} — retrying in ${retryDelay / 1000}s`);

    socket.onclose = () => {
      socket = null;
      listeners = []; // clear stale listeners; components re-register via useEffect
      setTimeout(() => siloSocket.connect(), retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    };
  },

  onSensorData: (callback: (data: any) => void) => {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((l) => l !== callback);
    };
  },

  sendCommand: (action: string, payload?: object) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "command", action, ...payload }));
      console.log(`📤 Sent command: ${action}`);
    }
  },
};