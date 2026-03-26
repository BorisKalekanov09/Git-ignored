require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 8080;

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
  roadQuality: 0,
  condition: "UNKNOWN",
  holesCount: 0
};


// ===============================
// WebSocket
// ===============================
wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
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
