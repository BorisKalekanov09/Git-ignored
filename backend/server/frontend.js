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

  function cellStatus(avgTemp) {
    if (avgTemp >= 35) return { status: 'danger',  color: 'red'    };
    if (avgTemp >= 28) return { status: 'warning', color: 'yellow' };
    return              { status: 'safe',    color: 'green'  };
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
    // Group by row (index_y)
    const rowMap = {};
    for (const c of cells) {
      if (!rowMap[c.index_y]) rowMap[c.index_y] = [];
      rowMap[c.index_y].push(c);
    }
    const sortedRows = Object.keys(rowMap).map(Number).sort((a, b) => a - b);

    // Rotate so startCell's row comes first
    const startRowIdx = sortedRows.indexOf(startCell.index_y);
    const orderedRows = [
      ...sortedRows.slice(startRowIdx >= 0 ? startRowIdx : 0),
      ...sortedRows.slice(0, startRowIdx >= 0 ? startRowIdx : 0),
    ];

    const result = [];
    orderedRows.forEach((rowKey, rowNum) => {
      const rowCells = [...rowMap[rowKey]].sort((a, b) => a.index_x - b.index_x);
      // Even rows → left to right, odd rows → right to left (snake)
      const ordered = rowNum % 2 === 0 ? rowCells : rowCells.reverse();
      result.push(...ordered);
    });
    return result;
  }

  // ─────────────────────────────────────────────────────────────────
  // Mission handlers (module-level, not per-connection)
  // ─────────────────────────────────────────────────────────────────

  async function startMission() {
    if (mission.running) {
      console.log('[Mission] Already running — ignoring duplicate deploy.');
      return;
    }

    console.log('[Mission] 🚀 Loading hangar data from Supabase...');

    // Query hangars — use limit(1) so multiple rows don't break maybeSingle()
    // Order by created_at desc to always pick the latest hangar
    const { data: hData, error: hErr } = await supabase
      .from('hangars')
      .select('id, width, height')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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

    // Find starting cell — pick the cell closest to (0,0) as default
    // (The user can override this via the app's "Set Starting Position" button
    //  if the hangars table supports starting_cell_id; otherwise we default.)
    let startCell = { index_x: 0, index_y: 0 };
    // Try starting_cell_id if the column exists on hData
    if (hData.starting_cell_id) {
      const sc = allCells.find(c => c.id === hData.starting_cell_id);
      if (sc) {
        startCell = { index_x: sc.index_x, index_y: sc.index_y };
      }
    }
    console.log(`[Mission] Starting cell: (${startCell.index_x}, ${startCell.index_y})`);

    // Build snake path
    mission.cells   = buildSnakeOrder(allCells, startCell);
    mission.idx     = 0;
    mission.running = true;

    console.log(`[Mission] Snake path: ${mission.cells.length} cells`);
    console.log(`[Mission] First 5: ${mission.cells.slice(0, 5).map(c => `(${c.index_x},${c.index_y})`).join(' → ')}`);

    sendGoto(mission.cells[mission.idx]);
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

    const { temperature, humidity } = data;
    const avgTemp = parseFloat(temperature) || 25;
    const avgHum  = parseFloat(humidity)    || 50;

    const { status, color } = cellStatus(avgTemp);
    console.log(`[Mission] ✅ Cell (${cell.index_x},${cell.index_y}) complete — temp=${avgTemp.toFixed(1)}°C → ${status}`);

    // Update Supabase
    if (mission.hangarId) {
      const { error } = await supabase
        .from('cells')
        .update({ status, last_visited_at: new Date().toISOString() })
        .match({ hangar_id: mission.hangarId, index_x: cell.index_x, index_y: cell.index_y });

      if (error) console.error('[Mission] Cell update error:', JSON.stringify(error));
    }

    // Save sensor reading
    await supabase.from('sensor_data').insert([{
      device_id:   latestSensorData.device_id || 'robot-01',
      temperature: avgTemp,
      humidity:    avgHum,
      latitude:    data.y_cm ?? null,
      longitude:   data.x_cm ?? null,
    }]);

    // Notify frontend with color
    broadcastData({
      type:         'cell_updated',
      x:            cell.index_x,
      y:            cell.index_y,
      status,
      color,
      avg_temp:     avgTemp,
      avg_humidity: avgHum,
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
          await startMission();
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
        if (data.x           !== undefined) latestSensorData.longitude   = data.x;
        if (data.y           !== undefined) latestSensorData.latitude    = data.y;
        if (data.latitude    !== undefined) latestSensorData.latitude    = data.latitude;
        if (data.longitude   !== undefined) latestSensorData.longitude   = data.longitude;

        // Persist telemetry
        const { error } = await supabase.from('sensor_data').insert([{
          device_id:   data.device_id   || 'robot-01',
          temperature: data.temperature ?? null,
          humidity:    data.humidity    ?? null,
          latitude:    data.latitude ?? data.y ?? null,
          longitude:   data.longitude ?? data.x ?? null,
        }]);
        if (error) console.error('[WS] Supabase telemetry insert error:', JSON.stringify(error));

        // Push live update to app
        broadcastData({
          type:        'sensor_data',
          temperature: latestSensorData.temperature,
          humidity:    latestSensorData.humidity,
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
