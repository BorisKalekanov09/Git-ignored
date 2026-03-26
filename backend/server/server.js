
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = 8080;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, host: '0.0.0.0' });

app.use(express.json());
app.use(express.static('public')); 

let latestSensorData = {
  roadQuality: 0,
  condition: "UNKNOWN",
  holesCount: 0
};


wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`[WebSocket] Client connected: ${clientIP}`);

  ws.send(JSON.stringify({ type: "sensor_data", data: latestSensorData }));

  ws.on('message', (message) => {
    console.log(`[WebSocket] Raw message: ${message}`);

    try {
      const data = JSON.parse(message);
      console.log("[Parsed JSON]", data);

      if (data.roadQuality !== undefined) latestSensorData.roadQuality = data.roadQuality;
      if (data.condition !== undefined) latestSensorData.condition = data.condition;
      if (data.holesCount !== undefined) latestSensorData.holesCount = data.holesCount;

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "sensor_data", data: latestSensorData }));
        }
      });

    } catch (err) {
      console.error("[Error] Failed to parse incoming message:", err);
    }
  });

  ws.on('close', () => console.log(`[WebSocket] Client disconnected: ${clientIP}`));
});


app.post('/data', (req, res) => {
  console.log("[HTTP] Received POST data:", req.body);

  if (req.body.roadQuality !== undefined) latestSensorData.roadQuality = req.body.roadQuality;
  if (req.body.condition !== undefined) latestSensorData.condition = req.body.condition;
  if (req.body.holesCount !== undefined) latestSensorData.holesCount = req.body.holesCount;

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "sensor_data", data: latestSensorData }));
    }
  });

  res.json({ status: 'success', received: latestSensorData });
});

app.get('/data', (req, res) => {
  console.log("[HTTP] GET /data requested");
  res.json(latestSensorData);
});


server.listen(PORT, () => {
  console.log(` Server running at: http://localhost:${PORT}`);
  console.log(" WebSocket listening on the same port");
});
