const axios = require('axios');
const SERVER_URL = 'http://localhost:8080/data';
const AUTH_KEY = '4775f0fb31998501257ac92598380e2f';

const CELL_SIZE = 0.2; // 20cm
const GRID_WIDTH = 10; // meters
const GRID_HEIGHT = 10; // meters

let currentX = 0;
let currentY = 0;
let movingRight = true;

async function sendMockData() {
  // 1. Move the robot logic
  if (movingRight) {
    currentX += 0.20; // move 20cm
    if (currentX >= GRID_WIDTH) {
      currentY += CELL_SIZE; // move to next row
      movingRight = false;
    }
  } else {
    currentX -= 0.05;
    if (currentX <= 0) {
      currentY += CELL_SIZE;
      movingRight = true;
    }
  }

  // Stop if we finish the hangar
  if (currentY >= GRID_HEIGHT) currentY = 0;

  // 2. Map meters to "GPS" decimals for your DB (simulating the small increments in your screenshot)
  // Based on your DB screenshot, 1 unit roughly equals the hangar width
  const lat = currentY / 1000; 
  const lon = currentX / 1000;

  const payload = {
    device_id: "mock-robot-01",
    temperature: (24 + Math.random() * 2).toFixed(1),
    humidity: (40 + Math.random() * 10).toFixed(0),
    latitude: lat,
    longitude: lon,
    speed: 1
  };

  try {
    await axios.post(SERVER_URL, payload, { params: { token: AUTH_KEY } });
    console.log(`Position: [${currentX.toFixed(2)}m, ${currentY.toFixed(2)}m] -> Cell: [${Math.floor(currentX/CELL_SIZE)}, ${Math.floor(currentY/CELL_SIZE)}]`);
  } catch (err) {
    console.error("Server Down:", err.message);
  }
}

setInterval(sendMockData, 1000);