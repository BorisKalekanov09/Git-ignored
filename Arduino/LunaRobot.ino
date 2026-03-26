// ============================================================
//  ESP32 LunaRobot - With Movement Logging + MPU6050 Calibration
// ============================================================

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include "secrets.h"

// ── Config ───────────────────────────────────────────────────
const char* ssid          = WIFI_SSID;
const char* password      = WIFI_PASS;
const char* serverAddress = "10.17.114.173";
const int   serverPort    = 8080;
const char* AUTH_KEY      = AUTH_KEY_VAL;
const char* DEVICE_ID     = "robot-01";

// ── L298N Motor Pins ─────────────────────────────────────────
#define IN1 25
#define IN2 14
#define ENA 33
#define IN3 13
#define IN4 26
#define ENB 27

#define DHTPIN  5
#define DHTTYPE DHT11

// ── Tunable ──────────────────────────────────────────────────
#define CM_PER_SECOND      20.0f
#define WAYPOINT_RADIUS_CM 15.0f
#define BASE_SPEED         180
#define KP                 2.5f

// ── Calibration ──────────────────────────────────────────────
#define CALIB_SAMPLES         200      // readings averaged during calibration
#define RECALIB_INTERVAL_MS   10000UL  // recalibrate every 10 s if not done
#define RECALIB_STOP_MS       2000UL   // stop motors for 2 s while recalibrating

float calibAxOffset = 0, calibAyOffset = 0;
float calibGzOffset = 0;
bool  isCalibrated  = false;
unsigned long lastCalibTime    = 0;
unsigned long recalibStopStart = 0;
bool  inRecalibStop = false;

// ── Waypoints (cm) ───────────────────────────────────────────
struct Waypoint { float x, y; };
Waypoint path[] = { {0,0}, {0,5}, {5,10}, {5,20} };
const int TOTAL_WP = sizeof(path) / sizeof(path[0]);
int wpIndex = 1;

// ── State machine ─────────────────────────────────────────────
enum State { DRIVING, STOPPED, DONE };
State state = DRIVING;
unsigned long stopTimer = 0;

// ── Position & Velocity ───────────────────────────────────────
float posX = 0, posY = 0, heading = 0;
float vx = 0, vy = 0;
unsigned long lastUpdate = 0;
int currentL = 0, currentR = 0;

// ── Objects ───────────────────────────────────────────────────
Adafruit_MPU6050 mpu;
DHT dht(DHTPIN, DHTTYPE);
WebSocketsClient ws;
unsigned long telTimer = 0;
unsigned long logTimer = 0;

// ─────────────────────────────────────────────────────────────
// ── Forward declaration ───────────────────────────────────────
// ─────────────────────────────────────────────────────────────
void motors(int l, int r);

// ─────────────────────────────────────────────────────────────
// ── Calibration routine ───────────────────────────────────────
// ─────────────────────────────────────────────────────────────
void calibrateMPU() {
  Serial.println("\n[CALIB] Starting MPU6050 calibration — keep robot still...");
  motors(0, 0);

  double sumAx = 0, sumAy = 0, sumGz = 0;

  for (int i = 0; i < CALIB_SAMPLES; i++) {
    sensors_event_t aEvent, gEvent, tempEvent;
    mpu.getEvent(&aEvent, &gEvent, &tempEvent);
    sumAx += aEvent.acceleration.x;
    sumAy += aEvent.acceleration.y;
    sumGz += gEvent.gyro.z;
    delay(5);  // ~5 ms per sample → ~1 s total
  }

  calibAxOffset = sumAx / CALIB_SAMPLES;
  calibAyOffset = sumAy / CALIB_SAMPLES;
  calibGzOffset = sumGz / CALIB_SAMPLES;

  isCalibrated  = true;
  lastCalibTime = millis();

  Serial.print("[CALIB] Done! Offsets — aX: "); Serial.print(calibAxOffset, 4);
  Serial.print(" | aY: ");  Serial.print(calibAyOffset, 4);
  Serial.print(" | gZ: ");  Serial.println(calibGzOffset, 4);
}

// ─────────────────────────────────────────────────────────────
void motors(int l, int r) {
  l = constrain(l, -255, 255);
  r = constrain(r, -255, 255);
  currentL = l; currentR = r;

  digitalWrite(IN1, l >= 0 ? HIGH : LOW);
  digitalWrite(IN2, l >= 0 ? LOW  : HIGH);
  analogWrite(ENA, abs(l));

  digitalWrite(IN3, r >= 0 ? HIGH : LOW);
  digitalWrite(IN4, r >= 0 ? LOW  : HIGH);
  analogWrite(ENB, abs(r));
}

// ── Update position using MPU6050 ─────────────────────────────
void updatePos() {
  if (!isCalibrated) return;

  static unsigned long lastIMU = 0;
  unsigned long now = millis();

  // ── FIX: skip first frame so dt is never a huge startup value ──
  if (lastIMU == 0) { lastIMU = now; return; }
  // ───────────────────────────────────────────────────────────────

  float dt = (now - lastIMU) / 1000.0f;
  lastIMU = now;

  // Safety clamp: skip frame if dt is suspiciously large (e.g. during calib stop)
  if (dt <= 0 || dt > 0.1f) return;

  sensors_event_t aEvent, gEvent, tempEvent;
  mpu.getEvent(&aEvent, &gEvent, &tempEvent);

  // Apply calibration offsets
  float ax = aEvent.acceleration.x - calibAxOffset;
  float ay = aEvent.acceleration.y - calibAyOffset;

  // Dead-zone: ignore noise smaller than sensor resolution
  if (fabsf(ax) < 0.05f) ax = 0;
  if (fabsf(ay) < 0.05f) ay = 0;

  vx += ax * dt;
  vy += ay * dt;

  posX += vx * dt * 100.0f;
  posY += vy * dt * 100.0f;

  // Damping to reduce drift
  vx *= 0.9f;
  vy *= 0.9f;

  if (now - logTimer >= 500) {
    Serial.print("[IMU Math] aX: "); Serial.print(ax, 2);
    Serial.print(" | vX: "); Serial.print(vx, 2);
    Serial.print(" | posX (cm): "); Serial.println(posX, 2);
  }
}

// ─────────────────────────────────────────────────────────────
void wsEvent(WStype_t type, uint8_t* p, size_t l) {
  if (type == WStype_CONNECTED)    Serial.println("WS connected");
  if (type == WStype_DISCONNECTED) Serial.println("WS disconnected");
}

void wsTask(void*) {
  while (1) { ws.loop(); vTaskDelay(10); }
}

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  pinMode(IN1,OUTPUT); pinMode(IN2,OUTPUT); pinMode(ENA,OUTPUT);
  pinMode(IN3,OUTPUT); pinMode(IN4,OUTPUT); pinMode(ENB,OUTPUT);
  motors(0, 0);

  Wire.begin(); dht.begin();
  if (!mpu.begin()) { Serial.println("MPU fail"); while(1); }
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_10_HZ);

  // ── Initial calibration on startup ───────────────────────────
  calibrateMPU();
  // ─────────────────────────────────────────────────────────────

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi OK");

  String url = "/data?token=" + String(AUTH_KEY);
  ws.begin(serverAddress, serverPort, url.c_str());
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(3000);
  xTaskCreatePinnedToCore(wsTask, "ws", 4096, NULL, 1, NULL, 0);

  lastUpdate = telTimer = logTimer = millis();
}

// ─────────────────────────────────────────────────────────────
void sendWebsocketData() {
  float speed = CM_PER_SECOND * ((abs(currentL) + abs(currentR)) / 2.0f) / BASE_SPEED;
  String msg = "{\"device_id\":\"" + String(DEVICE_ID)              + "\""
              + ",\"wp\":"          + String(wpIndex)
              + ",\"x\":"           + String(posX, 1)
              + ",\"y\":"           + String(posY, 1)
              + ",\"temperature\":" + String(dht.readTemperature(), 1)
              + ",\"humidity\":"    + String(dht.readHumidity(), 1)
              + ",\"latitude\":"    + String(posY, 4)
              + ",\"longitude\":"   + String(posX, 4)
              + ",\"speed\":"       + String(speed, 1)
              + "}";
  ws.sendTXT(msg);
}

// ─────────────────────────────────────────────────────────────
// ── Periodic recalibration check (called every loop) ─────────
// ─────────────────────────────────────────────────────────────
void checkRecalibration(unsigned long now) {
  if (inRecalibStop) {
    if (now - recalibStopStart >= RECALIB_STOP_MS) {
      inRecalibStop = false;
      calibrateMPU();
      // Reset velocities so the post-stop integration starts clean
      vx = 0;
      vy = 0;
    }
    return;
  }

  if (state == DRIVING && (now - lastCalibTime >= RECALIB_INTERVAL_MS)) {
    Serial.println("\n[CALIB] 10 s without recalibration — stopping for 2 s to recalibrate...");
    motors(0, 0);
    inRecalibStop    = true;
    recalibStopStart = now;
  }
}

// ─────────────────────────────────────────────────────────────
void calculateMovement(unsigned long now) {
  if (inRecalibStop) return;

  switch (state) {

  case DRIVING: {
    if (wpIndex >= TOTAL_WP) {
      motors(0, 0);
      state = DONE;
      Serial.println("[STATE] All Waypoints Reached. DONE.");
      break;
    }

    float dx   = path[wpIndex].x - posX;
    float dy   = path[wpIndex].y - posY;
    float dist = sqrt(dx*dx + dy*dy);

    if (dist <= WAYPOINT_RADIUS_CM) {
      motors(0, 0);
      state     = STOPPED;
      stopTimer = now;
      Serial.println("\n[STATE] Waypoint reached! Calibrating then stopping for 5 seconds...");

      // ── Calibrate at waypoint ─────────────────────────────────
      calibrateMPU();
      vx = 0;
      vy = 0;
      // ─────────────────────────────────────────────────────────
      break;
    }

    float angle = atan2(dy, dx);
    float speed = BASE_SPEED;

    int leftMotor  = speed * (1.0f - KP * angle);
    int rightMotor = speed * (1.0f + KP * angle);

    motors(leftMotor, rightMotor);

    if (now - logTimer >= 500) {
      Serial.print("[NAV] TargetWP: "); Serial.print(wpIndex);
      Serial.print(" | Dist remaining: "); Serial.print(dist, 1);
      Serial.print(" | L Motor: "); Serial.print(leftMotor);
      Serial.print(" | R Motor: "); Serial.println(rightMotor);
    }
    break;
  }

  case STOPPED:
    if (now - stopTimer >= 5000) {
      wpIndex++;
      state = DRIVING;
      Serial.print("\n[STATE] 5 seconds passed. Moving to WP ");
      Serial.println(wpIndex);
      vx = 0;
      vy = 0;
    }
    break;

  case DONE:
    motors(0, 0);
    break;
  }
}

// ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  checkRecalibration(now);

  updatePos();

  if (now - telTimer >= 3000) {
    sendWebsocketData();
    telTimer = now;
  }

  calculateMovement(now);

  if (now - logTimer >= 500) {
    logTimer = now;
  }

  delay(10);
}