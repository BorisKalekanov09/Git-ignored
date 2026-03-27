const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 8080;

// ===============================
// Supabase — use service role key to bypass RLS on server side
// ===============================
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (!process.env.SUPABASE_SERVICE_KEY) {
  console.warn('[Supabase] ⚠️  SUPABASE_SERVICE_KEY not set! Falling back to anon key — RLS will block server queries.');
  console.warn('[Supabase]    Get your service_role key from: Supabase Dashboard → Settings → API → service_role (secret)');
}
const supabase = createClient(
  process.env.SUPABASE_URL,
  supabaseKey
);

// ===============================
// HTTP + WebSocket server
// ===============================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, host: '0.0.0.0' });

app.use(express.json());
app.use(express.static('public'));

// ===============================
// Shared in-memory state
// ===============================
const latestSensorData = {
  device_id: 'UNKNOWN',
  temperature: 0,
  co2: 0,
  humidity: 0,
  latitude: 0,
  longitude: 0,
};

function broadcastData(customPayload = null) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      if (customPayload) {
        client.send(JSON.stringify(customPayload));
      } else {
        client.send(JSON.stringify({ type: 'sensor_data', data: latestSensorData }));
      }
    }
  });
}
async function processCellUpdate(data) {
  try {
    const lat = data.latitude ?? data.y;
    const lon = data.longitude ?? data.x;
    if (lat === undefined || lon === undefined) return;

    // ── THE MULTIPLIER ──
    // If your mock-robot sends 0.001, we multiply by 1000 to get 1 meter.
    const MULTIPLIER = 1000; 
    const cellSize = 0.2; // 20cm

    const metersX = lon * MULTIPLIER;
    const metersY = lat * MULTIPLIER;

    const cellX = Math.floor(metersX / cellSize);
    const cellY = Math.floor(metersY / cellSize);

    // Get the active hangar 
    const { data: hangar } = await supabase.from('hangars').select('id').limit(1).maybeSingle();

    if (hangar) {
      const { error } = await supabase
        .from('cells')
        .update({ 
          status: 'completed', 
          last_visited_at: new Date().toISOString() 
        })
        .match({ 
          hangar_id: hangar.id, 
          index_x: cellX, 
          index_y: cellY 
        });

      if (!error) {
        console.log(`[Cell] Marked cell (${cellX}, ${cellY}) as COMPLETED`);
      }
    }
  } catch (err) {
    console.error('[Cell Error]', err);
  }
}

// ===============================
// Mount route modules
// ===============================
const shared = {
  supabase,
  latestSensorData,
  broadcastData,
  processCellUpdate,
  AUTH_KEY: process.env.ESP32_AUTH_KEY,
};

require('./arduino')(app, shared);
require('./frontend')(app, wss, WebSocket, shared);

// ===============================
// Start server
// ===============================
server.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT}`);
  console.log('WebSocket running on same port');
});
