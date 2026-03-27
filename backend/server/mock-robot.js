/**
 * mock-robot.js — Simulates the LunaBot for end-to-end testing.
 *
 * How it works:
 *  1. Connects to the server via WebSocket (same as the real robot).
 *  2. Waits for a `deploy` command from the app (or auto-deploys after 2s if --auto flag is set).
 *  3. Receives `goto` messages from the server (server drives the snake path).
 *  4. Simulates travel time to each cell, then sends `cell_complete` back.
 *  5. The server marks the cell in Supabase and sends the next `goto`.
 *  6. When the server broadcasts `mission_complete`, the sim stops.
 *
 * Usage:
 *   node server/mock-robot.js           — waits for the app to press Deploy
 *   node server/mock-robot.js --auto    — auto-deploys immediately on connect
 */
'use strict';

const WebSocket = require('ws');

const SERVER_WS  = process.env.SERVER_WS  || 'ws://localhost:8080';
const AUTH_KEY   = process.env.AUTH_KEY   || 'e4d2c8f1a5b9d3c7b2e1f4a9d6e8b4c2';
const AUTO_DEPLOY = process.argv.includes('--auto');

// How long in ms the robot "travels" to each cell before reporting complete.
// Lower = faster simulation.
const TRAVEL_MS  = 600;

// Sensor reading generators — realistic random values
const randTemp = () => +(20 + Math.random() * 20).toFixed(1);  // 20–40 °C
const randHum  = () => +(40 + Math.random() * 50).toFixed(0);  // 40–90 %
const randAQ   = () => +(500 + Math.random() * 3000).toFixed(0); // 500–3500 ppm

let ws;
let connected  = false;
let currentPos = { x_cm: 0, y_cm: 0 };
let pendingGoto = null;
let processing  = false;

function connect() {
  const url = `${SERVER_WS}?token=${AUTH_KEY}`;
  console.log(`[MockRobot] Connecting to ${SERVER_WS}...`);
  ws = new WebSocket(url);

  ws.on('open', () => {
    connected = true;
    console.log('[MockRobot] ✅ Connected to server.');

    if (AUTO_DEPLOY) {
      console.log('[MockRobot] --auto flag detected, sending deploy in 1s...');
      setTimeout(() => sendDeploy(), 1000);
    } else {
      console.log('[MockRobot] ⏳ Waiting for the app to press Deploy...');
    }
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'goto') {
      // Server is telling us to go to a cell
      pendingGoto = msg;
      if (!processing) processGoto();
    }

    if (msg.type === 'command' && msg.action === 'recall') {
      console.log('[MockRobot] 🛑 Recall received — stopping simulation.');
      processing  = false;
      pendingGoto = null;
    }

    if (msg.type === 'mission_complete') {
      console.log('[MockRobot] 🏁 Mission complete! All cells visited.');
      processing  = false;
      pendingGoto = null;
    }

    if (msg.type === 'mission_error') {
      console.error('[MockRobot] ❌ Mission error:', msg.message);
    }
  });

  ws.on('close', () => {
    connected = false;
    console.log('[MockRobot] Disconnected. Reconnecting in 3s...');
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('[MockRobot] WS error:', err.message);
  });
}

function processGoto() {
  if (!pendingGoto || processing) return;
  processing = true;
  const target = pendingGoto;
  pendingGoto  = null;

  const dist = Math.hypot(target.x_cm - currentPos.x_cm, target.y_cm - currentPos.y_cm);
  // Scale travel time by distance (min 200ms, max TRAVEL_MS * 2)
  const travelTime = Math.min(TRAVEL_MS * 2, Math.max(200, (dist / 20) * TRAVEL_MS));

  console.log(`[MockRobot] 🚗 Travelling ${dist.toFixed(0)}cm to (${target.x_cm}, ${target.y_cm}) — ETA ${travelTime.toFixed(0)}ms`);

  setTimeout(() => {
    currentPos = { x_cm: target.x_cm, y_cm: target.y_cm };

    const temp = randTemp();
    const hum  = randHum();
    const aq   = randAQ();

    const label =
      temp >= 35 ? '🔴 DANGER'
      : temp >= 28 ? '🟡 WARN'
      : '🟢 SAFE';

    console.log(`[MockRobot] ✅ Arrived at (${target.x_cm}, ${target.y_cm}) — Temp: ${temp}°C  Hum: ${hum}%  AQ: ${aq}  ${label}`);

    send({
      type:        'cell_complete',
      x_cm:        target.x_cm,
      y_cm:        target.y_cm,
      temperature: temp,
      humidity:    hum,
      air_quality: aq,
      air_digital: aq < 2500 ? 1 : 0, // digital sensor: 0 = danger threshold
    });

    processing = false;

    // If another goto arrived while we were travelling, handle it
    if (pendingGoto) processGoto();
  }, travelTime);
}

function sendDeploy() {
  console.log('[MockRobot] 📡 Sending deploy command...');
  send({ type: 'command', action: 'deploy' });
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

connect();
