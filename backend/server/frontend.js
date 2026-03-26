/**
 * frontend.js — WebSocket handler + HTTP GET for the mobile app
 *
 * GET  /data      — return latest sensor snapshot
 * WS   (upgrade)  — real-time push to connected clients
 */
module.exports = function setupFrontendRoutes(app, wss, WebSocket, {
  supabase,
  latestSensorData,
  broadcastData,
  processCellUpdate,
  AUTH_KEY,
}) {

  // ===============================
  // GET latest data snapshot
  // ===============================
  app.get('/data', (req, res) => {
    console.log('[Frontend] GET /data requested');
    res.json(latestSensorData);
  });

  // ===============================
  // WebSocket — real-time updates
  // ===============================
  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const token = urlParams.get('token');

    // Auth check
    if (AUTH_KEY && token !== AUTH_KEY) {
      console.warn(`[Frontend] Unauthorized WS connection from ${clientIP}`);
      ws.close(1008, 'Unauthorized');
      return;
    }

    console.log(`[Frontend] Client connected: ${clientIP}`);

    // Send current state immediately on connect
    ws.send(JSON.stringify({ type: 'sensor_data', data: latestSensorData }));

    ws.on('message', async (message) => {
      console.log(`[Frontend] Raw message: ${message}`);

      try {
        const data = JSON.parse(message);

        // Update shared in-memory state
        if (data.device_id   !== undefined) latestSensorData.device_id   = data.device_id;
        if (data.temperature !== undefined) latestSensorData.temperature = data.temperature;
        if (data.co2         !== undefined) latestSensorData.co2         = data.co2;
        if (data.humidity    !== undefined) latestSensorData.humidity    = data.humidity;
        if (data.latitude    !== undefined) latestSensorData.latitude    = data.latitude;
        if (data.longitude   !== undefined) latestSensorData.longitude   = data.longitude;
        if (data.roadQuality !== undefined) latestSensorData.roadQuality = data.roadQuality;
        if (data.condition   !== undefined) latestSensorData.condition   = data.condition;
        if (data.holesCount  !== undefined) latestSensorData.holesCount  = data.holesCount;

        // Persist to Supabase
        const { error } = await supabase
          .from('sensor_data')
          .insert([{
            device_id:   data.device_id   || 'esp32_car_1',
            temperature: data.temperature ?? null,
            co2:         data.co2         ?? null,
            humidity:    data.humidity    ?? null,
            latitude:    data.latitude    ?? null,
            longitude:   data.longitude   ?? null,
            speed:       data.speed       ?? null,
          }]);

        if (error) {
          console.error('[Frontend] Supabase insert error:', error);
        } else {
          console.log('[Frontend] Data inserted into Supabase');
          processCellUpdate(data);
        }

        broadcastData();

      } catch (err) {
        console.error('[Frontend] Failed to parse WS message:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[Frontend] Client disconnected: ${clientIP}`);
    });
  });

};
