const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Validate required environment variables early
const REQUIRED_ENV = ['SUPABASE_URL', 'ESP32_AUTH_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[Startup] ❌ Missing required env vars: ${missing.join(', ')}`);
  console.error('[Startup]    Create a .env file in the backend directory. See .env.example');
  process.exit(1);
}

// This looks in the CURRENT folder, then the parent folder for a .env
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 
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

    const cellSize = 20; // Now in CM
    const cellX = Math.floor(lon / cellSize);
    const cellY = Math.floor(lat / cellSize);

    // Range for this cell
    const minX = cellX * cellSize;
    const maxX = (cellX + 1) * cellSize;
    const minY = cellY * cellSize;
    const maxY = (cellY + 1) * cellSize;

    const { data: hangar } = await supabase.from('hangars').select('id').limit(1).maybeSingle();

    if (hangar) {
      // 1. Fetch all sensor data points recorded for this specific square/cell
      const { data: points, error: pErr } = await supabase
        .from('sensor_data')
        .select('temperature, humidity, air_quality')
        .gte('longitude', minX)
        .lt('longitude', maxX)
        .gte('latitude', minY)
        .lt('latitude', maxY);

      if (pErr) throw pErr;

      // 2. Calculate the average if we have points
      let avgTemp = 0, avgHum = 0, avgAir = 0, status = 'completed';
      
      if (points && points.length > 0) {
        avgTemp = points.reduce((acc, p) => acc + (parseFloat(p.temperature) || 0), 0) / points.length;
        avgHum  = points.reduce((acc, p) => acc + (parseFloat(p.humidity)    || 0), 0) / points.length;
        avgAir  = points.reduce((acc, p) => acc + (parseFloat(p.air_quality) || 0), 0) / points.length;

        // Determine status based on thresholds (Matching the frontend.js logic)
        if (avgTemp >= 35 || avgHum >= 85 || avgAir > 3000) status = 'danger';
        else if (avgTemp >= 28 || avgHum >= 70 || avgAir > 2000) status = 'warning';
        else status = 'safe';
      }

      // 3. Update the cells table with the REAL averages
      const { error } = await supabase
        .from('cells')
        .update({ 
          status, 
          avg_temp: avgTemp,
          avg_humidity: avgHum,
          avg_air_quality: avgAir,
          last_visited_at: new Date().toISOString() 
        })
        .match({ hangar_id: hangar.id, index_x: cellX, index_y: cellY });

      if (!error) {
        console.log(`[Cell Update] Refreshed (${cellX}, ${cellY}) | Samples: ${points?.length || 0} | AvgTemp: ${avgTemp.toFixed(1)}°C | Status: ${status}`);
        
        // Notify the frontend so the map updates colors immediately
        broadcastData({
          type: 'cell_updated',
          x: cellX,
          y: cellY,
          status,
          avg_temp: avgTemp,
          avg_humidity: avgHum,
          avg_air_quality: avgAir
        });
      }
    }
  } catch (err) {
    if (err.message && !err.message.includes('getaddrinfo ENOTFOUND')) {
      console.error('[Cell Error]', err);
    }
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
server.listen(PORT, async () => {
  console.log(`Server running at: http://localhost:${PORT}`);
  console.log('WebSocket running on same port');

  // Auto-clear any stuck active deployments from previous crash/restart
  // so the mobile app is never permanently locked out
  try {
    const { error } = await supabase
      .from('deployments')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('status', 'active');
    
    if (!error) {
      console.log('[Startup] ✅ Cleared any stuck active deployments.');
    } else {
      console.warn('[Startup] ⚠️  Could not clear deployments:', error.message);
      if (error.message.includes('getaddrinfo ENOTFOUND')) {
        console.error('[Supabase] 🛑 PROJECT NOT FOUND: Your SUPABASE_URL is either wrong, or the project is PAUSED/DELETED.');
      }
    }
  } catch (err) {
    console.warn('[Startup] ⚠️  Supabase connection failed. Server will continue in Offline/Live-only mode.', err.message);
  }
});
