/**
 * arduino.js — HTTP routes for ESP32 / Arduino data ingestion
 *
 * POST /data  — receive sensor data from the robot
 */
module.exports = function setupArduinoRoutes(app, {
  supabase,
  latestSensorData,
  broadcastData,
  processCellUpdate,
  AUTH_KEY,
}) {

  app.post('/data', async (req, res) => {
    // Auth check
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.split(' ')[1] : req.query.token;

    if (AUTH_KEY && token !== AUTH_KEY) {
      console.warn(`[Arduino] Unauthorized POST from ${req.ip}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[Arduino] Received POST data:', req.body);

    try {
      const data = req.body;

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
        console.error('[Arduino] Supabase insert error:', error);
        return res.status(500).json({ error });
      }

      processCellUpdate(data);
      broadcastData();

      res.json({ status: 'saved to supabase', received: latestSensorData });

    } catch (err) {
      console.error('[Arduino] HTTP error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

};
