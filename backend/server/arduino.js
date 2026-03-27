module.exports = function setupArduinoRoutes(app, {
  supabase,
  latestSensorData,
  broadcastData,
  processCellUpdate,
  AUTH_KEY,
}) {

  app.post('/data', async (req, res) => {
    // 1. Auth check
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.split(' ')[1] : req.query.token;

    if (AUTH_KEY && token !== AUTH_KEY) {
      console.warn(`[Arduino] Unauthorized POST from ${req.ip}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const data = req.body;
      console.log('[Arduino] Incoming Data:', data);

      // 2. Update shared in-memory state (for the live dashboard)
      if (data.device_id !== undefined)   latestSensorData.device_id = data.device_id;
      latestSensorData.temperature = parseFloat(data.temperature) || 0;
      latestSensorData.humidity    = parseFloat(data.humidity)    || 0;
      latestSensorData.latitude    = parseFloat(data.latitude)    || 0;
      latestSensorData.longitude   = parseFloat(data.longitude)   || 0;

      // 3. Persist to Supabase
      const { error } = await supabase
        .from('sensor_data')
        .insert([{
          device_id:   data.device_id   || 'luna-bot-01',
          temperature: latestSensorData.temperature,
          humidity:    latestSensorData.humidity,
          latitude:    latestSensorData.latitude,
          longitude:   latestSensorData.longitude,
          speed:       data.speed || 1
        }]);

      if (error) {
        // This log is the most important part for your demo debugging
        console.error('❌ DB INSERT ERROR:', error.message, error.details);
        return res.status(500).json({ error: error.message });
      }

      // 4. Update the Grid and Broadcast to the App
      console.log('✅ Data Saved to Supabase');
      processCellUpdate(data);
      broadcastData();

      // 5. Send ONE final response
      return res.json({ status: 'success', received: latestSensorData });

    } catch (err) {
      console.error('❌ Server Crash in /data:', err);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  });
};