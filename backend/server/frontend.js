/**
 * frontend.js — WebSocket handler for the mobile app + mission orchestrator
 *
 * Server → Robot:  {"type":"goto","x_cm":30.0,"y_cm":50.0}
 * Robot → Server:  {"type":"cell_complete","x_cm":N,"y_cm":M,"temperature":T,"humidity":H}
 *
 * Cell status thresholds (temperature-based):
 *   >= 35°C  → danger  (red)
 *   >= 28°C  → warning (yellow)
 *   < 28°C   → safe    (green)
 */
module.exports = function setupFrontendRoutes(app, wss, WebSocket, {
  supabase,
  latestSensorData,
  broadcastData,
  processCellUpdate,
  AUTH_KEY,
}) {

  // ── GET /data: latest sensor snapshot for REST clients ──────────
  app.get('/data', (req, res) => {
    res.json(latestSensorData);
  });

  // ── MODULE-LEVEL mission state (shared across all WS connections) ──
  // This prevents duplicate deploy executions if both robot + app connect.
  const mission = {
    cells:     [],    // ordered cell list: [{id, index_x, index_y}, ...]
    idx:       0,     // pointer into cells
    hangarId:  null,
    running:   false, // guard against double-deploy
  };

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  function cellStatus(avgTemp, avgHum, avgAir) {
    if (avgTemp >= 35 || avgHum >= 85 || avgAir > 3000) return { status: 'danger',  color: 'red'    };
    if (avgTemp >= 28 || avgHum >= 70 || avgAir > 2000) return { status: 'warning', color: 'yellow' };
    return                                                       { status: 'safe',    color: 'green'  };
  }

  const CELL_SIZE_CM = 20.0; // 20cm × 20cm per cell

  function cellToCm(c) {
    return {
      x_cm: c.index_x * CELL_SIZE_CM + CELL_SIZE_CM / 2,
      y_cm: c.index_y * CELL_SIZE_CM + CELL_SIZE_CM / 2,
    };
  }

  function sendGoto(cell) {
    const { x_cm, y_cm } = cellToCm(cell);
    console.log(`[Mission] ➡ GOTO (${cell.index_x},${cell.index_y}) => x_cm=${x_cm} y_cm=${y_cm}`);
    broadcastData({ type: 'goto', x_cm, y_cm });
  }

  // Build snake-pattern ordered cell list, starting from startCell's row
  function buildSnakeOrder(cells, startCell) {
    const rowMap = {};
    for (const c of cells) {
      if (!rowMap[c.index_y]) rowMap[c.index_y] = [];
      rowMap[c.index_y].push(c);
    }
    const sortedRows = Object.keys(rowMap).map(Number).sort((a, b) => a - b);

    // Rotate/subset rows so startCell's row comes first (sweeping downwards)
    const startRowIdx = sortedRows.indexOf(startCell.index_y);
    const orderedRows = [
      ...sortedRows.slice(startRowIdx >= 0 ? startRowIdx : 0),
      ...sortedRows.slice(0, startRowIdx >= 0 ? startRowIdx : 0),
    ];

    const result = [];
    orderedRows.forEach((rowKey, rowNum) => {
      const rowCells = [...rowMap[rowKey]].sort((a, b) => a.index_x - b.index_x);
      let ordered;
      if (rowNum === 0) {
        // First row: start exactly at startCell, sweep to right, then catch left side
        const si = rowCells.findIndex(c => c.index_x === startCell.index_x);
        ordered = [...rowCells.slice(si), ...rowCells.slice(0, si).reverse()];
      } else {
        // Alternating snake pattern
        ordered = rowNum % 2 === 0 ? rowCells : rowCells.reverse();
      }
      result.push(...ordered);
    });
    return result;
  }

  // ─────────────────────────────────────────────────────────────────
  // Mission handlers (module-level, not per-connection)
  // ─────────────────────────────────────────────────────────────────

  async function startMission(startingX, startingY, appHangarId) {
    if (mission.running) {
      console.log('[Mission] Already running — ignoring duplicate deploy.');
      return;
    }

    console.log('[Mission] 🚀 Loading hangar data from Supabase...');

    let hQuery = supabase
      .from('hangars')
      .select('id, width, height, starting_cell_id');

    if (appHangarId) {
      console.log(`[Mission] Using explicit hangar_id from app: ${appHangarId}`);
      hQuery = hQuery.eq('id', appHangarId);
    } else {
      console.warn('[Mission] ⚠️ No hangar_id from app — picking latest as fallback.');
      hQuery = hQuery.order('created_at', { ascending: false });
    }

    const { data: hData, error: hErr } = await hQuery.limit(1).maybeSingle();

    console.log('[Mission] Hangar query result:', JSON.stringify({ hData, hErr }));

    if (hErr) {
      console.error('[Mission] Supabase hangar ERROR:', JSON.stringify(hErr));
      broadcastData({ type: 'mission_error', message: 'Supabase error: ' + (hErr.message || JSON.stringify(hErr)) });
      return;
    }
    if (!hData) {
      console.error('[Mission] No hangar row found. Check RLS policies on the hangars table.');
      broadcastData({ type: 'mission_error', message: 'No hangar found. Check Supabase RLS policies.' });
      return;
    }

    console.log(`[Mission] Hangar: id=${hData.id}  width=${hData.width}  height=${hData.height}`);
    mission.hangarId = hData.id;

    // Query cells for this hangar
    const { data: allCells, error: cErr } = await supabase
      .from('cells')
      .select('id, index_x, index_y, status')
      .eq('hangar_id', hData.id);

    console.log(`[Mission] Cells query: count=${allCells?.length ?? 0}  err=${JSON.stringify(cErr)}`);

    if (cErr) {
      console.error('[Mission] Supabase cells ERROR:', JSON.stringify(cErr));
      return;
    }
    if (!allCells || allCells.length === 0) {
      console.error('[Mission] No cells found for hangar', hData.id);
      broadcastData({ type: 'mission_error', message: 'No cells found. Generate the grid in the app first.' });
      return;
    }

    console.log(`[Mission] ${allCells.length} cells loaded.`);

    // Find starting cell by x,y coordinates (most reliable — bypasses hangar UUID mismatch)
    let startCell = { index_x: 0, index_y: 0 };
    if (startingX !== undefined && startingY !== undefined) {
      const sc = allCells.find(c => c.index_x === startingX && c.index_y === startingY);
      if (sc) {
        startCell = { index_x: sc.index_x, index_y: sc.index_y };
        console.log(`[Mission] ✅ Starting from cell (${sc.index_x}, ${sc.index_y}) — matched by coordinates.`);
      } else {
        console.warn(`[Mission] No cell found at (${startingX}, ${startingY}) — defaulting to (0,0)`);
      }
    } else {
      console.log('[Mission] No starting position provided — defaulting to (0,0)');
    }

    // Build snake path
    mission.cells   = buildSnakeOrder(allCells, startCell);
    mission.idx     = 0;
    mission.running = true;
    // Store start position so recall can navigate the robot home
    const startCm = cellToCm(startCell);
    mission.startX  = startCm.x_cm;
    mission.startY  = startCm.y_cm;

    console.log(`[Mission] Snake path: ${mission.cells.length} cells`);
    console.log(`[Mission] First 5: ${mission.cells.slice(0, 5).map(c => `(${c.index_x},${c.index_y})`).join(' → ')}`);

    // Teleport the robot to the starting coordinate so its worldX and worldY match the grid
    broadcastData({ type: 'set_pos', x_cm: mission.startX, y_cm: mission.startY });

    setTimeout(() => {
      sendGoto(mission.cells[mission.idx]);
    }, 200);
  }

  async function handleCellComplete(data) {
    if (!mission.running) {
      console.warn('[Mission] Received cell_complete but no mission is running — ignoring.');
      return;
    }

    const cell = mission.cells[mission.idx];
    if (!cell) {
      console.warn('[Mission] cell_complete received but mission.idx is out of bounds!');
      return;
    }

    const { temperature, humidity, air_quality, air_digital } = data;
    const avgTemp = parseFloat(temperature) || 25;
    const avgHum  = parseFloat(humidity)    || 50;
    const avgAir  = parseFloat(air_quality) || 0;
    const digAir  = parseInt(air_digital)   || 0;

    const { status, color } = cellStatus(avgTemp, avgHum, avgAir);
    console.log(`[Mission] ✅ Cell (${cell.index_x},${cell.index_y}) complete — temp=${avgTemp.toFixed(1)}°C hum=${avgHum}% air=${avgAir} → ${status}`);

    // Update Supabase with REAL averages calculated from all sensor data in this cell
    await processCellUpdate(data);

    // Save sensor reading
    await supabase.from('sensor_data').insert([{
      device_id:   latestSensorData.device_id || 'robot-01',
      temperature: avgTemp,
      humidity:    avgHum,
      air_quality: avgAir, // Assuming these columns exist
      air_digital: digAir,
      latitude:    data.y_cm ?? null,
      longitude:   data.x_cm ?? null,
    }]);

    // Notify frontend
    broadcastData({
      type:            'cell_updated',
      x:               cell.index_x,
      y:               cell.index_y,
      status,
      color,
      avg_temp:        avgTemp,
      avg_humidity:    avgHum,
      avg_air_quality: avgAir,
      dig_air:         digAir,
    });

    // Advance
    mission.idx++;

    if (mission.idx >= mission.cells.length) {
      console.log('[Mission] 🏁 Mission complete! All cells visited.');
      mission.running = false;
      broadcastData({ type: 'mission_complete' });
      return;
    }

    // Small pause → next cell
    setTimeout(() => {
      if (mission.running) sendGoto(mission.cells[mission.idx]);
    }, 500);
  }

  function abortMission() {
    console.log('[Mission] 🛑 RECALL — aborting mission.');
    mission.running = false;
    mission.cells   = [];
    mission.idx     = 0;
    broadcastData({ type: 'command', action: 'recall' });
    broadcastData({ type: 'mission_status', status: 'stopped', reason: 'recalled' });
    // Send robot back to starting position
    if (mission.startX !== undefined && mission.startY !== undefined) {
      console.log(`[Mission] Sending robot home: x_cm=${mission.startX} y_cm=${mission.startY}`);
      setTimeout(() => broadcastData({ type: 'goto', x_cm: mission.startX, y_cm: mission.startY }), 100);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // WebSocket connections
  // ─────────────────────────────────────────────────────────────────
  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    const urlParams = new URLSearchParams((req.url || '').split('?')[1] || '');
    const token = urlParams.get('token');

    // Auth
    if (AUTH_KEY && token !== AUTH_KEY) {
      console.warn(`[WS] Denied — unauthorized token from ${clientIP}`);
      ws.close(1008, 'Unauthorized');
      return;
    }
    console.log(`[WS] Connected: ${clientIP}`);

    // Send current snapshot immediately
    ws.send(JSON.stringify({ type: 'sensor_data', data: latestSensorData }));

    // If a mission is running and a robot just connected mid-mission,
    // re-send the current goto so it doesn't get stuck waiting
    if (mission.running && mission.cells[mission.idx]) {
      const c = mission.cells[mission.idx];
      const { x_cm, y_cm } = cellToCm(c);
      console.log(`[Mission] New client connected mid-mission — resending GOTO (${c.index_x},${c.index_y})`);
      ws.send(JSON.stringify({ type: 'goto', x_cm, y_cm }));
    }

    ws.on('message', async (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error('[WS] Bad JSON:', raw.toString().slice(0, 100));
        return;
      }

      // ── cell_complete from robot ──────────────────────────────
      if (data.type === 'cell_complete') {
        await handleCellComplete(data);
        return;
      }

      // ── Commands from the app ─────────────────────────────────
      if (data.type === 'command') {
        if (data.action === 'deploy') {
          await startMission(data.starting_x, data.starting_y, data.hangar_id);
        } else if (data.action === 'recall') {
          abortMission();
        } else {
          broadcastData(data);
        }
        return;
      }

      // ── Telemetry / sensor data from robot ───────────────────
      // Robot sends JSON with device_id (and no `type` field, or type != known types)
      if (data.device_id !== undefined || data.temperature !== undefined) {
        // Update live snapshot
        if (data.device_id   !== undefined) latestSensorData.device_id   = data.device_id;
        if (data.temperature !== undefined) latestSensorData.temperature = data.temperature;
        if (data.humidity    !== undefined) latestSensorData.humidity    = data.humidity;
        if (data.air_quality !== undefined) latestSensorData.air_quality = data.air_quality;
        if (data.air_digital !== undefined) latestSensorData.air_digital = data.air_digital;
        if (data.x           !== undefined) latestSensorData.longitude   = data.x;
        if (data.y           !== undefined) latestSensorData.latitude    = data.y;
        if (data.latitude    !== undefined) latestSensorData.latitude    = data.latitude;
        if (data.longitude   !== undefined) latestSensorData.longitude   = data.longitude;
 
        // Print sensor values to terminal
        console.log(`[Telemetry] Robot: ${data.device_id || '???'} | Temp: ${data.temperature}°C | Hum: ${data.humidity}% | Air: ${data.air_quality} | Pos: (${(data.x ?? data.longitude ?? 0).toFixed(1)}, ${(data.y ?? data.latitude ?? 0).toFixed(1)})`);

        // Persist telemetry (Quietly, so missing Supabase doesn't spam logs with fetch errors)
        try {
          const { error } = await supabase.from('sensor_data').insert([{
            device_id:   data.device_id   || 'robot-01',
            temperature: data.temperature ?? null,
            humidity:    data.humidity    ?? null,
            air_quality: data.air_quality ?? null,
            air_digital: data.air_digital ?? null,
            latitude:    data.latitude  ?? data.y  ?? latestSensorData.latitude  ?? 0,
            longitude:   data.longitude ?? data.x  ?? latestSensorData.longitude ?? 0,
          }]);
          if (error && !error.message.includes('getaddrinfo ENOTFOUND')) {
             console.error('[WS] Supabase telemetry insert error:', JSON.stringify(error));
          }
        } catch (e) {
          // Ignore connection errors during telemetry insert
        }

        // Live Grid Update: If we have position data, update the map squares in real-time
        if (data.x !== undefined || data.y !== undefined || data.latitude !== undefined || data.longitude !== undefined) {
          processCellUpdate(data);
        }

        // Push live update to app
        broadcastData({
          type:        'sensor_data',
          temperature: latestSensorData.temperature,
          humidity:    latestSensorData.humidity,
          air_quality: latestSensorData.air_quality,
          air_digital: latestSensorData.air_digital,
          latitude:    latestSensorData.latitude,
          longitude:   latestSensorData.longitude,
          x:           latestSensorData.longitude,
          y:           latestSensorData.latitude,
        });
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Disconnected: ${clientIP}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error (${clientIP}):`, err.message);
    });
  });
};
