// services/websocket.ts
import * as Constants from 'expo-constants';

// Multi-source fallback: env vars → app.json extra → hardcoded defaults
const getServerIP = () => {
  const envIP = process.env.EXPO_PUBLIC_SERVER_IP?.trim();
  if (envIP && envIP !== 'undefined') return envIP;
  
  try {
    const configIP = (Constants.default?.expoConfig as any)?.extra?.serverIP;
    if (configIP) return configIP;
  } catch (e) {}
  
  return '10.244.103.197'; // fallback
};

const getAuthKey = () => {
  const envKey = process.env.EXPO_PUBLIC_ESP32_AUTH_KEY?.trim();
  if (envKey && envKey !== 'undefined') return envKey;
  
  try {
    const configKey = (Constants.default?.expoConfig as any)?.extra?.authKey;
    if (configKey) return configKey;
  } catch (e) {}
  
  return '4775f0fb31998501257ac92598380e2f'; // fallback
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

    socket.onopen = () => console.log("🚀 Connected to:", SERVER_URL);

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "sensor_data") {
          const payload = message.data ?? message;
          listeners.forEach((callback) => callback(payload));
        }
      } catch (e) {
        console.error("WS Parse Error", e);
      }
    };

    socket.onerror = (e) => console.error("WS Error:", e);

    socket.onclose = () => {
      socket = null;
      setTimeout(() => siloSocket.connect(), 3000);
    };
  },

  onSensorData: (callback: (data: any) => void) => {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((l) => l !== callback);
    };
  },

  sendCommand: (action: string) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "command", action }));
      console.log(`📤 Sent command: ${action}`);
    }
  },
};