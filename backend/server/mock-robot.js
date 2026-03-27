const axios = require('axios');
const SERVER_URL = 'http://localhost:8080/data'; // Or your Hotspot IP
const AUTH_KEY = 'e4d2c8f1a5b9d3c7b2e1f4a9d6e8b4c2';

let x = 0; 
let y = 0;
let movingRight = true;

const step = 20;         // 5cm per second
const rowWidth = 200;   // 2 meters
const rowSpacing = 20;  // 20cm rows (matches your grid)

async function sendMockData() {
  // 1. Movement Logic (The "Mow the Lawn" S-Curve)
  if (movingRight) {
    x += step;
    if (x >= rowWidth) { 
      y += rowSpacing; 
      movingRight = false; r
    }
  } else {
    x -= step;
    if (x <= 0) { 
      y += rowSpacing; 
      movingRight = true; 
    }
  }

  // Reset mission if we reach the end of the 2m area
  if (y > 200) {
    y = 0;
    x = 0;
    movingRight = true;
  }

  const payload = {
    device_id: "luna-bot-01",
    temperature: Number((26 + Math.random() * 2).toFixed(1)),
    humidity: Number((45 + Math.random() * 5).toFixed(0)),
    latitude: y,  // Centimeters
    longitude: x, // Centimeters
    speed: 1
  };
  
  try {
    await axios.post(SERVER_URL, payload, { params: { token: AUTH_KEY } });
    console.log(`🤖 Robot at: X=${x}cm, Y=${y}cm | Temp: ${payload.temperature}°C`);
  } catch (err) {
    console.error("❌ Backend unreachable. Check if your server is running on port 8080.");
  }
}

console.log("🚀 Simulation started. Sending data every 1s...");
setInterval(sendMockData, 1000);