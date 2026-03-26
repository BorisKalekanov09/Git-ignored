require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 8080;
const AUTH_KEY = process.env.ESP32_AUTH_KEY;

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Updates cell status based on robot position
 */
async function processCellUpdate(data) {
  try {
    if (data.latitude === undefined || data.longitude === undefined) return;

    // 20cm cells = 0.2 units
    const cellSize = 0.2;
    const cellX = Math.floor(data.longitude / cellSize);
    const cellY = Math.floor(data.latitude / cellSize);

    // Get the first hangar for now (simplification)
    const { data: hangar } = await supabase.from('hangars').select('id').limit(1).maybeSingle();
    
    if (hangar) {
      const { error } = await supabase
        .from('cells')
        .update({ status: 'completed', last_visited_at: new Date() })
        .match({ hangar_id: hangar.id, index_x: cellX, index_y: cellY });
        
      if (!error) {
        console.log(`[Cell] Marked cell (${cellX}, ${cellY}) as completed`);
      }
    }
  } catch (err) {
    console.error("[Cell Error]", err);
  }
}

// HTTP + WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, host: '0.0.0.0' });

app.use(express.json());
app.use(express.static('public'));

// In-memory state (for realtime UI)
let latestSensorData = {
  device_id: "UNKNOWN",
  temperature: 0,
  co2: 0,
  humidity: 0,
  latitude: 0,
  longitude: 0,

};


// ===============================
// WebSocket
// ===============================
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  const urlParams = new URLSearchParams(req.url.split('?')[1]);
  const token = urlParams.get('token');

  // Verify token
  if (AUTH_KEY && token !== AUTH_KEY) {
    console.warn(`[WebSocket] Unauthorized connection attempt from ${clientIP}`);
    ws.close(1008, "Unauthorized"); // 1008 is Policy Violation
    return;
  }

  console.log(`[WebSocket] Client connected: ${clientIP}`);

  // Send latest data immediately
  ws.send(JSON.stringify({ type: "sensor_data", data: latestSensorData }));

  ws.on('message', async (message) => {
    console.log(`[WebSocket] Raw message: ${message}`);

    try {
      const data = JSON.parse(message);

      // Update local state
      if (data.device_id !== undefined) latestSensorData.device_id = data.device_id;
      if (data.temperature !== undefined) latestSensorData.temperature = data.temperature;
      if (data.co2 !== undefined) latestSensorData.co2 = data.co2;
      if (data.humidity !== undefined) latestSensorData.humidity = data.humidity;
      if (data.latitude !== undefined) latestSensorData.latitude = data.latitude;
      if (data.longitude !== undefined) latestSensorData.longitude = data.longitude;
      if (data.roadQuality !== undefined) latestSensorData.roadQuality = data.roadQuality;
      if (data.condition !== undefined) latestSensorData.condition = data.condition;
      if (data.holesCount !== undefined) latestSensorData.holesCount = data.holesCount;

      // Insert into Supabase
      const { error } = await supabase
        .from('sensor_data')
        .insert([
          {
            device_id: data.device_id || 'esp32_car_1',
            temperature: data.temperature ?? null,
            co2: data.co2 ?? null,
            humidity: data.humidity ?? null,
            latitude: data.latitude ?? null,
            longitude: data.longitude ?? null,
            speed: data.speed ?? null,
          }
        ]);

      if (error) {
        console.error("Supabase insert error:", error);
      } else {
        console.log("Data inserted into Supabase");
        // Process cell updates
        processCellUpdate(data);
      }

      // Broadcast to all clients
      broadcastData();

    } catch (err) {
      console.error("[Error] Failed to parse WebSocket message:", err);
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] Client disconnected: ${clientIP}`);
  });
});


// ===============================
// HTTP POST (ESP32 or other)
// ===============================
app.post('/data', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader ? authHeader.split(' ')[1] : req.query.token;

  if (AUTH_KEY && token !== AUTH_KEY) {
    console.warn(`[HTTP] Unauthorized POST from ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log("[HTTP] Received POST data:", req.body);

  try {
    const data = req.body;

    // Update local state
    if (data.device_id !== undefined) latestSensorData.device_id = data.device_id;
    if (data.temperature !== undefined) latestSensorData.temperature = data.temperature;
    if (data.co2 !== undefined) latestSensorData.co2 = data.co2;
    if (data.humidity !== undefined) latestSensorData.humidity = data.humidity;
    if (data.latitude !== undefined) latestSensorData.latitude = data.latitude;
    if (data.longitude !== undefined) latestSensorData.longitude = data.longitude;
    if (data.roadQuality !== undefined) latestSensorData.roadQuality = data.roadQuality;
    if (data.condition !== undefined) latestSensorData.condition = data.condition;
    if (data.holesCount !== undefined) latestSensorData.holesCount = data.holesCount;

    // Insert into Supabase
    const { error } = await supabase
      .from('sensor_data')
      .insert([
        {
          device_id: data.device_id || 'esp32_car_1',
          temperature: data.temperature ?? null,
          co2: data.co2 ?? null,
          humidity: data.humidity ?? null,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          speed: data.speed ?? null,
        }
      ]);

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error });
    }

    // Process cell updates
    processCellUpdate(data);

    // Broadcast to clients
    broadcastData();

    res.json({ status: 'saved to supabase', received: latestSensorData });

  } catch (err) {
    console.error("[HTTP ERROR]", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ===============================
// GET latest data
// ===============================
app.get('/data', (req, res) => {
  console.log("[HTTP] GET /data requested");
  res.json(latestSensorData);
});


// ===============================
// Broadcast helper
// ===============================
function broadcastData() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: "sensor_data",
        data: latestSensorData
      }));
    }
  });
}


// ===============================
// Start server
// ===============================
server.listen(PORT, () => {
  console.log(`Server running at: http://localhost:${PORT}`);
  console.log("WebSocket running on same port");
});
