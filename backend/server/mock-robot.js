const axios = require('axios');

const SERVER_URL = 'http://localhost:8080/data';
const AUTH_KEY = '4775f0fb31998501257ac92598380e2f';

let angle = 0;

async function sendMockData() {
  // Move in a small circle around your previous GPS points
  const lat = 6.3376 + Math.sin(angle) * 0.001;
  const lon = -1.1211 + Math.cos(angle) * 0.001;
  
  const payload = {
    device_id: "mock-robot-01",
    temperature: (25 + Math.random() * 5).toFixed(1),
    humidity: 13,
    latitude: lat,
    longitude: lon,
    speed: 1
  };

  try {
    await axios.post(SERVER_URL, payload, {
      params: { token: AUTH_KEY }
    });
    console.log(`Mock data sent: Lat ${lat.toFixed(4)}, Lon ${lon.toFixed(4)}`);
  } catch (err) {
    console.error("Failed to send mock data:", err.message);
  }

  angle += 0.2;
}

console.log("Starting robot simulation...");
setInterval(sendMockData, 2000);