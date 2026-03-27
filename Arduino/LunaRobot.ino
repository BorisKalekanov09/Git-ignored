// ============================================================
//  ESP32 LunaRobot — 90° Step Navigation
//
//  Phase 1: Drive forward TARGET_Y_CM  (ultrasonic + gyro lock)
//  Phase 2: Turn 90° in place          (gyro Z integration)
//  Phase 3: Drive forward TARGET_X_CM  (ultrasonic + gyro lock)
// ============================================================

#include <Wire.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <math.h>
#include "config.h"
#include "hardware.h"

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
enum State { CALIB, DRIVE_Y, TURN, DRIVE_X, DONE, FAULT };
State state = CALIB;

float distTraveled   = 0.0f;
float sonarStart     = 0.0f;
float worldX         = 0.0f;
float worldY         = 0.0f;

unsigned long telTimer       = 0;
unsigned long logTimer       = 0;
unsigned long phaseStartTime = 0;

// ─────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────
WebSocketsClient ws;

void wsEvent(WStype_t type, uint8_t* p, size_t len) {
  if (type == WStype_CONNECTED)    Serial.println(F("[WS] Connected to server."));
  if (type == WStype_DISCONNECTED) Serial.println(F("[WS] Disconnected from server."));
}

void wsTask(void*) { while (1) { ws.loop(); vTaskDelay(10); } }

void sendTelemetry() {
  String msg = "{\"device_id\":\""   + String(DEVICE_ID)   + "\""
             + ",\"x\":"             + String(worldX, 1)
             + ",\"y\":"             + String(worldY, 1)
             + ",\"target_x\":"      + String(TARGET_X_CM, 1)
             + ",\"target_y\":"      + String(TARGET_Y_CM, 1)
             + ",\"dist_traveled\":" + String(distTraveled, 1)
             + ",\"heading_deg\":"   + String(heading * 180.0f / PI, 1)
             + ",\"temperature\":"   + String(dht.readTemperature(), 1)
             + ",\"humidity\":"      + String(dht.readHumidity(), 1)
             + ",\"latitude\":"      + String(worldY, 4)
             + ",\"longitude\":"     + String(worldX, 4)
             + "}";
  ws.sendTXT(msg);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
void setFault()  { state = FAULT; }

void printSeparator() {
  Serial.println(F("------------------------------------------------------------"));
}

void printBanner(const char* title) {
  Serial.println();
  printSeparator();
  Serial.print(F("  ")); Serial.println(title);
  printSeparator();
}

float phaseElapsed() {
  return (millis() - phaseStartTime) / 1000.0f;
}

void resetHeadingState() {
  heading        = 0.0f;
  lastGyroTime   = 0;
  lastHeadingErr = 0.0f;
}

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  printBanner("ESP32 LUNAROBOT STARTING");
  Serial.println(F("  Navigation : 90-degree step (Y forward, turn, X forward)"));
  Serial.println(F("  Sensors    : MPU6050 gyro + HC-SR04 ultrasonic + DHT11"));
  printSeparator();

  motorsInit();
  sonarInit();

  Wire.begin();
  dht.begin();
  if (!mpu.begin()) {
    Serial.println(F("[ERROR] MPU6050 not found on I2C — halting!"));
    while (1);
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_10_HZ);
  Serial.println(F("[INIT] MPU6050 found and configured."));
  Serial.println(F("         Accel : ±4g  |  Gyro : ±500°/s  |  LPF : 10 Hz"));

  calibrateMPU();

  // Sonar self-test
  printBanner("ULTRASONIC SELF-TEST");
  Serial.println(F("  Taking 5 readings — make sure there is an object/wall ahead:"));
  float sonarSum = 0;
  for (int i = 0; i < 5; i++) {
    float r = readSonarCm();
    sonarSum += r;
    Serial.print(F("  Reading ")); Serial.print(i + 1); Serial.print(F(": "));
    Serial.print(r, 1); Serial.println(F(" cm"));
    delay(100);
  }
  float sonarAvg = sonarSum / 5.0f;
  Serial.print(F("  Average : ")); Serial.print(sonarAvg, 1); Serial.println(F(" cm"));
  if (sonarAvg >= SONAR_MAX_CM - 1.0f)
    Serial.println(F("  [WARN] Readings maxed out — no object detected ahead!"));
  else
    Serial.println(F("  [OK] Object detected. Sonar is healthy."));
  printSeparator();

  // WiFi
  Serial.println(F("[WIFI] Connecting..."));
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int wifiTries = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(F("."));
    if (++wifiTries > 30) { Serial.println(F("\n[WIFI] Timeout — continuing without WiFi.")); break; }
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print(F("[WIFI] Connected. IP: ")); Serial.println(WiFi.localIP());
  }

  // WebSocket
  String url = "/data?token=" + String(AUTH_KEY);
  ws.begin(SERVER_ADDRESS, SERVER_PORT, url.c_str());
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(3000);
  xTaskCreatePinnedToCore(wsTask, "ws", 4096, NULL, 1, NULL, 0);
  Serial.print(F("[WS] Connecting to ")); Serial.print(SERVER_ADDRESS);
  Serial.print(F(":")); Serial.println(SERVER_PORT);

  telTimer = logTimer = millis();

  // Mission plan summary
  printBanner("MISSION PLAN");
  Serial.println(F("  LEG 1 — Drive forward (Y axis)"));
  Serial.print(F("           Distance : ")); Serial.print(TARGET_Y_CM, 1); Serial.println(F(" cm"));
  Serial.print(F("           Speed    : ")); Serial.println(DRIVE_SPEED);
  Serial.println();
  Serial.println(F("  LEG 2 — Turn in place"));
  Serial.print(F("           Angle    : ")); Serial.print(TURN_DEGREES, 0);
  Serial.print(F("°  ")); Serial.println(TURN_DIRECTION > 0 ? F("LEFT (CCW)") : F("RIGHT (CW)"));
  Serial.print(F("           Speed    : ")); Serial.println(TURN_SPEED);
  Serial.println();
  Serial.println(F("  LEG 3 — Drive forward (X axis)"));
  Serial.print(F("           Distance : ")); Serial.print(TARGET_X_CM, 1); Serial.println(F(" cm"));
  Serial.print(F("           Speed    : ")); Serial.println(DRIVE_SPEED);
  printSeparator();

  // Validate sonar before Leg 1
  resetHeadingState();
  distTraveled   = 0.0f;
  sonarStart     = readSonarCm();
  phaseStartTime = millis();

  if (!sonarStartCheck(sonarStart, "LEG 1", setFault)) return;

  state = DRIVE_Y;
  printBanner("STARTING LEG 1 — DRIVE FORWARD (Y)");
  Serial.print(F("  Sonar at start      : ")); Serial.print(sonarStart, 1); Serial.println(F(" cm to wall"));
  Serial.print(F("  Target sonar reading: ")); Serial.print(sonarStart - TARGET_Y_CM, 1); Serial.println(F(" cm"));
  Serial.print(F("  Must travel         : ")); Serial.print(TARGET_Y_CM, 1); Serial.println(F(" cm"));
  printSeparator();
}

// ─────────────────────────────────────────────────────────────
// Loop
// ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  updateHeading();

  if (now - telTimer >= 3000) { sendTelemetry(); telTimer = now; }

  switch (state) {

  // ── Leg 1: drive forward TARGET_Y_CM ──────────────────────
  case DRIVE_Y: {
    float sonarNow = readSonarCm();

    if (sonarNow >= SONAR_MAX_CM - 1.0f || sonarNow <= 2.0f) {
      Serial.println(F("[Y-LEG] [WARN] Bad sonar reading — skipping iteration."));
      driveStraight(0.0f);
      break;
    }

    distTraveled    = sonarStart - sonarNow;
    if (distTraveled < 0) distTraveled = 0;
    float remaining = TARGET_Y_CM - distTraveled;
    float progress  = constrain((distTraveled / TARGET_Y_CM) * 100.0f, 0, 100);
    bool  arrived   = distTraveled >= (TARGET_Y_CM - ARRIVE_TOLERANCE_CM);

    if (now - logTimer >= 400) {
      Serial.print(F("[Y-LEG]"));
      Serial.print(F("  traveled: "));    Serial.print(distTraveled, 1);          Serial.print(F(" cm"));
      Serial.print(F("  remaining: "));   Serial.print(remaining, 1);             Serial.print(F(" cm"));
      Serial.print(F("  progress: "));    Serial.print(progress, 0);              Serial.print(F("%"));
      Serial.print(F("  sonar: "));       Serial.print(sonarNow, 1);              Serial.print(F(" cm"));
      Serial.print(F("  heading: "));     Serial.print(heading * 180.0f / PI, 2); Serial.print(F("°"));
      Serial.print(F("  t+"));            Serial.print(phaseElapsed(), 1);        Serial.println(F("s"));
    }

    if (arrived) {
      motors(0, 0);
      worldY = distTraveled;

      printBanner("LEG 1 COMPLETE");
      Serial.print(F("  Traveled   : ")); Serial.print(distTraveled, 1);                      Serial.println(F(" cm"));
      Serial.print(F("  Target was : ")); Serial.print(TARGET_Y_CM, 1);                       Serial.println(F(" cm"));
      Serial.print(F("  Error      : ")); Serial.print(fabsf(distTraveled - TARGET_Y_CM), 1); Serial.println(F(" cm"));
      Serial.print(F("  Heading    : ")); Serial.print(heading * 180.0f / PI, 2);             Serial.println(F("°"));
      Serial.print(F("  Time       : ")); Serial.print(phaseElapsed(), 1);                    Serial.println(F(" s"));
      printSeparator();

      resetHeadingState();
      phaseStartTime = millis();
      state          = TURN;

      printBanner("STARTING LEG 2 — TURN");
      Serial.print(F("  Direction  : ")); Serial.println(TURN_DIRECTION > 0 ? F("LEFT (CCW)") : F("RIGHT (CW)"));
      Serial.print(F("  Goal       : ")); Serial.print(TURN_DEGREES, 0); Serial.println(F("°"));
      Serial.print(F("  Tolerance  : ±")); Serial.print(TURN_TOLERANCE_DEG, 1); Serial.println(F("°"));
      printSeparator();
    } else {
      driveStraight(0.0f);
    }
    break;
  }

  // ── Leg 2: Turn 90° ───────────────────────────────────────
  case TURN: {
    float targetRad = TURN_DIRECTION * TURN_DEGREES * PI / 180.0f;
    float turned    = heading;
    float remaining = targetRad - turned;
    float progress  = constrain((fabsf(turned) / TURN_DEGREES) * (180.0f / PI) * 100.0f, 0, 100);
    bool  turnDone  = fabsf(remaining) <= (TURN_TOLERANCE_DEG * PI / 180.0f);

    if (now - logTimer >= 200) {
      Serial.print(F("[TURN]"));
      Serial.print(F("  turned: "));    Serial.print(turned * 180.0f / PI, 1);    Serial.print(F("°"));
      Serial.print(F("  remaining: ")); Serial.print(remaining * 180.0f / PI, 1); Serial.print(F("°"));
      Serial.print(F("  progress: "));  Serial.print(progress, 0);                Serial.print(F("%"));
      Serial.print(F("  t+"));          Serial.print(phaseElapsed(), 1);          Serial.println(F("s"));
    }

    if (turnDone) {
      motors(0, 0);
      delay(200);

      printBanner("LEG 2 COMPLETE");
      Serial.print(F("  Turned     : ")); Serial.print(turned * 180.0f / PI, 2);                              Serial.println(F("°"));
      Serial.print(F("  Target was : ")); Serial.print(TURN_DEGREES, 0);                                      Serial.println(F("°"));
      Serial.print(F("  Error      : ")); Serial.print(fabsf(fabsf(turned * 180.0f / PI) - TURN_DEGREES), 2); Serial.println(F("°"));
      Serial.print(F("  Time       : ")); Serial.print(phaseElapsed(), 1);                                    Serial.println(F(" s"));
      printSeparator();

      resetHeadingState();
      distTraveled   = 0.0f;
      phaseStartTime = millis();

      sonarStart = readSonarCm();
      if (!sonarStartCheck(sonarStart, "LEG 3", setFault)) break;

      state = DRIVE_X;
      printBanner("STARTING LEG 3 — DRIVE FORWARD (X)");
      Serial.print(F("  Sonar at start      : ")); Serial.print(sonarStart, 1); Serial.println(F(" cm to wall"));
      Serial.print(F("  Target sonar reading: ")); Serial.print(sonarStart - TARGET_X_CM, 1); Serial.println(F(" cm"));
      Serial.print(F("  Must travel         : ")); Serial.print(TARGET_X_CM, 1); Serial.println(F(" cm"));
      printSeparator();
    } else {
      if (TURN_DIRECTION > 0) motors( TURN_SPEED, -TURN_SPEED);
      else                    motors(-TURN_SPEED,  TURN_SPEED);
    }
    break;
  }

  // ── Leg 3: drive forward TARGET_X_CM ──────────────────────
  case DRIVE_X: {
    float sonarNow = readSonarCm();

    if (sonarNow >= SONAR_MAX_CM - 1.0f || sonarNow <= 2.0f) {
      Serial.println(F("[X-LEG] [WARN] Bad sonar reading — skipping iteration."));
      driveStraight(0.0f);
      break;
    }

    distTraveled    = sonarStart - sonarNow;
    if (distTraveled < 0) distTraveled = 0;
    float remaining = TARGET_X_CM - distTraveled;
    float progress  = constrain((distTraveled / TARGET_X_CM) * 100.0f, 0, 100);
    bool  arrived   = distTraveled >= (TARGET_X_CM - ARRIVE_TOLERANCE_CM);

    if (now - logTimer >= 400) {
      Serial.print(F("[X-LEG]"));
      Serial.print(F("  traveled: "));    Serial.print(distTraveled, 1);          Serial.print(F(" cm"));
      Serial.print(F("  remaining: "));   Serial.print(remaining, 1);             Serial.print(F(" cm"));
      Serial.print(F("  progress: "));    Serial.print(progress, 0);              Serial.print(F("%"));
      Serial.print(F("  sonar: "));       Serial.print(sonarNow, 1);              Serial.print(F(" cm"));
      Serial.print(F("  heading: "));     Serial.print(heading * 180.0f / PI, 2); Serial.print(F("°"));
      Serial.print(F("  t+"));            Serial.print(phaseElapsed(), 1);        Serial.println(F("s"));
    }

    if (arrived) {
      motors(0, 0);
      worldX = distTraveled;

      printBanner("LEG 3 COMPLETE");
      Serial.print(F("  Traveled   : ")); Serial.print(distTraveled, 1);                      Serial.println(F(" cm"));
      Serial.print(F("  Target was : ")); Serial.print(TARGET_X_CM, 1);                       Serial.println(F(" cm"));
      Serial.print(F("  Error      : ")); Serial.print(fabsf(distTraveled - TARGET_X_CM), 1); Serial.println(F(" cm"));
      Serial.print(F("  Heading    : ")); Serial.print(heading * 180.0f / PI, 2);             Serial.println(F("°"));
      Serial.print(F("  Time       : ")); Serial.print(phaseElapsed(), 1);                    Serial.println(F(" s"));
      printSeparator();

      state = DONE;
      printBanner("*** MISSION COMPLETE ***");
      Serial.println(F("  Final report:"));
      Serial.print(F("    Y traveled : ")); Serial.print(worldY, 1);
      Serial.print(F(" cm  /  target: ")); Serial.print(TARGET_Y_CM, 1);
      Serial.print(F(" cm  /  error: ")); Serial.print(fabsf(worldY - TARGET_Y_CM), 1); Serial.println(F(" cm"));
      Serial.print(F("    X traveled : ")); Serial.print(worldX, 1);
      Serial.print(F(" cm  /  target: ")); Serial.print(TARGET_X_CM, 1);
      Serial.print(F(" cm  /  error: ")); Serial.print(fabsf(worldX - TARGET_X_CM), 1); Serial.println(F(" cm"));
      Serial.println(F("  Robot stopped. Sending telemetry every 10s."));
      printSeparator();
    } else {
      driveStraight(0.0f);
    }
    break;
  }

  // ── Done ──────────────────────────────────────────────────
  case DONE:
    motors(0, 0);
    if (now - telTimer >= 10000) { sendTelemetry(); telTimer = now; }
    break;

  // ── Fault — safe stop ─────────────────────────────────────
  case FAULT:
    motors(0, 0);
    if (now - logTimer >= 5000)
      Serial.println(F("[FAULT] Robot halted due to sensor error. Power cycle to restart."));
    break;

  case CALIB:
  default:
    motors(0, 0);
    break;
  }

  if (now - logTimer >= 400) logTimer = now;
  delay(10);
}