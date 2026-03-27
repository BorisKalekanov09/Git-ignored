// ============================================================
//  ESP32 LunaRobot — Cell-to-Cell Autonomous Navigation
//
//  Server sends: {"type":"goto","x_cm":30.0,"y_cm":50.0}
//  Robot drives there from its current position, stays 2-3s,
//  collects sensor data, then sends "cell_complete" back.
//
//  Motor convention:
//    screwSpin()    = both motors same direction = FORWARD
//    driveStraight() = dominant + partial oppose  = TURN
// ============================================================

#include <Wire.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <math.h>
#include "config.h"
#include "hardware.h"

// ─────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────
enum State {
  CALIB,
  WAITING,
  DRIVE_FWD,
  TURN,
  SAMPLING,
  FAULT
};
State state = CALIB;

// ─────────────────────────────────────────────────────────────
// Mission state
// ─────────────────────────────────────────────────────────────
float worldX = 0.0f;
float worldY = 0.0f;
int   discreteHeading = 0; // 0=+Y, 1=+X, 2=-Y, 3=-X

float distTraveled     = 0.0f;
float sonarStart       = 0.0f;
float currentDriveDist = 0.0f;
float currentTurnDeg   = 90.0f;
int   currentTurnDir   = 1;   // 1 = CCW/left, -1 = CW/right

float gotoX = 0.0f;
float gotoY = 0.0f;

enum DrivePhase { PH_NONE, PH_TURN, PH_FORWARD, PH_SAMPLE };
DrivePhase driveQueue[4];
int        driveQueueLen = 0;
int        driveQueueIdx = 0;

unsigned long sampleStart  = 0;
#define SAMPLE_DURATION_MS 2500
float sampleTempSum = 0.0f;
float sampleHumSum  = 0.0f;
float sampleAirSum  = 0.0f;
int   sampleCount   = 0;

unsigned long telTimer       = 0;
unsigned long logTimer       = 0;
unsigned long phaseStartTime = 0;

// ─────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────
WebSocketsClient ws;

// ─────────────────────────────────────────────────────────────
// Forward declarations
// ─────────────────────────────────────────────────────────────
void startNextPhase();
void startPhase(DrivePhase ph);
void updateWorldPosAfterForward();
void printBanner(const char* title);
void printSeparator();
void resetHeadingState();
void setFault();

// ─────────────────────────────────────────────────────────────
// Telemetry
// ─────────────────────────────────────────────────────────────
void sendCellComplete() {
  float avgTemp = (sampleCount > 0) ? (sampleTempSum / sampleCount) : dht.readTemperature();
  float avgHum  = (sampleCount > 0) ? (sampleHumSum  / sampleCount) : dht.readHumidity();
  float avgAir  = (sampleCount > 0) ? (sampleAirSum  / sampleCount) : analogRead(AIR_QUALITY_AO);
  int   digAir  = digitalRead(AIR_QUALITY_DO);

  String msg = "{\"type\":\"cell_complete\""
               ",\"x_cm\":"        + String(worldX, 1) +
               ",\"y_cm\":"        + String(worldY, 1) +
               ",\"temperature\":" + String(avgTemp, 2) +
               ",\"humidity\":"    + String(avgHum, 2) +
               ",\"air_quality\":" + String(avgAir, 2) +
               ",\"air_digital\":" + String(digAir) + "}";
  ws.sendTXT(msg);
  Serial.println(F("[CELL] cell_complete sent to server."));
  Serial.print(F("       Avg temp=")); Serial.print(avgTemp, 1);
  Serial.print(F("  Avg hum="));       Serial.println(avgHum, 1);
}

void sendTelemetry() {
  String msg = "{\"device_id\":\""  + String(DEVICE_ID) + "\""
             + ",\"x\":"            + String(worldX, 1)
             + ",\"y\":"            + String(worldY, 1)
             + ",\"heading_deg\":"  + String(heading * 180.0f / PI, 1)
             + ",\"temperature\":"  + String(dht.readTemperature(), 1)
             + ",\"humidity\":"     + String(dht.readHumidity(), 1)
             + ",\"air_quality\":"  + String(analogRead(AIR_QUALITY_AO))
             + ",\"air_digital\":"  + String(digitalRead(AIR_QUALITY_DO))
             + ",\"latitude\":"     + String(worldY, 4)
             + ",\"longitude\":"    + String(worldX, 4) + "}";
  ws.sendTXT(msg);
}

// ─────────────────────────────────────────────────────────────
// Navigation helpers
// ─────────────────────────────────────────────────────────────
int headingDiff(int from, int to) {
  return (to - from + 4) % 4;
}

bool planTurn(int desiredHeading) {
  int diff = headingDiff(discreteHeading, desiredHeading);
  if (diff == 0) return false;
  if (diff == 1)      { currentTurnDir =  1; currentTurnDeg =  90.0f; }
  else if (diff == 3) { currentTurnDir = -1; currentTurnDeg =  90.0f; }
  else                { currentTurnDir = -1; currentTurnDeg = 180.0f; }
  return true;
}

void buildDriveQueue(float tx, float ty) {
  driveQueueLen = 0;
  driveQueueIdx = 0;
  float dx = tx - worldX;
  float dy = ty - worldY;

  // ── X leg ──
  if (fabsf(dx) > ARRIVE_TOLERANCE_CM) {
    int desiredH = (dx > 0) ? 1 : 3;
    if (planTurn(desiredH)) driveQueue[driveQueueLen++] = PH_TURN;
    driveQueue[driveQueueLen++] = PH_FORWARD;
  }

  // ── Y leg — always queue a turn so heading is re-evaluated ──
  if (fabsf(dy) > ARRIVE_TOLERANCE_CM) {
    driveQueue[driveQueueLen++] = PH_TURN;    // skipped at runtime if not needed
    driveQueue[driveQueueLen++] = PH_FORWARD;
  }

  driveQueue[driveQueueLen++] = PH_SAMPLE;
}

// ─────────────────────────────────────────────────────────────
// Phase executor
// ─────────────────────────────────────────────────────────────
void startPhase(DrivePhase ph) {
  float dx = gotoX - worldX;
  float dy = gotoY - worldY;

  switch (ph) {

    case PH_TURN: {
      int desiredH;
      if (fabsf(dx) > ARRIVE_TOLERANCE_CM) desiredH = (dx > 0) ? 1 : 3;
      else                                 desiredH = (dy > 0) ? 0 : 2;
      if (!planTurn(desiredH)) {
        driveQueueIdx++;
        startNextPhase();
        return;
      }
      resetHeadingState();
      phaseStartTime = millis();
      state = TURN;
      printBanner("PHASE: TURN");
      Serial.print(F("  Dir: "));
      Serial.print(currentTurnDir > 0 ? F("CCW (left)") : F("CW (right)"));
      Serial.print(F("  Deg: ")); Serial.println(currentTurnDeg, 1);
      break;
    }

    case PH_FORWARD: {
      float dist = (discreteHeading == 1 || discreteHeading == 3)
                   ? fabsf(dx) : fabsf(dy);
      if (dist < ARRIVE_TOLERANCE_CM) {
        driveQueueIdx++;
        startNextPhase();
        return;
      }
      currentDriveDist = dist;
      distTraveled     = 0.0f;
      sonarStart       = readSonarCm();
      resetHeadingState();
      phaseStartTime   = millis();
      state            = DRIVE_FWD;
      printBanner("PHASE: DRIVE FORWARD");
      Serial.print(F("  Target dist : ")); Serial.print(dist, 1);       Serial.println(F(" cm"));
      Serial.print(F("  Sonar start : ")); Serial.print(sonarStart, 1); Serial.println(F(" cm"));
      break;
    }

    case PH_SAMPLE: {
      motors(0, 0);
      sampleTempSum = 0.0f; sampleHumSum = 0.0f;
      sampleAirSum  = 0.0f; sampleCount  = 0;
      sampleStart   = millis();
      state         = SAMPLING;
      printBanner("PHASE: SAMPLING AT CELL");
      break;
    }

    default: break;
  }
}

void startNextPhase() {
  if (driveQueueIdx >= driveQueueLen) {
    sendCellComplete();
    state = WAITING;
    printBanner("CELL COMPLETE — WAITING FOR NEXT");
    return;
  }
  startPhase(driveQueue[driveQueueIdx]);
}

// ─────────────────────────────────────────────────────────────
// WebSocket event handler
// ─────────────────────────────────────────────────────────────
void wsEvent(WStype_t type, uint8_t* p, size_t len) {
  if (type == WStype_CONNECTED)    Serial.println(F("[WS] Connected to server."));
  if (type == WStype_DISCONNECTED) Serial.println(F("[WS] Disconnected from server."));

  if (type == WStype_TEXT) {
    String payload = (char*)p;

    if (payload.indexOf("\"type\":\"goto\"") >= 0 && state == WAITING) {
      int xi = payload.indexOf("\"x_cm\":");
      int yi = payload.indexOf("\"y_cm\":");
      if (xi < 0 || yi < 0) return;

      float tx = payload.substring(xi + 7).toFloat();
      float ty = payload.substring(yi + 7).toFloat();
      gotoX = tx; gotoY = ty;

      Serial.println();
      Serial.print(F("[WS] GOTO → target X:")); Serial.print(tx, 1);
      Serial.print(F(" cm   Y:"));               Serial.print(ty, 1); Serial.println(F(" cm"));
      Serial.print(F("      current X:"));        Serial.print(worldX, 1);
      Serial.print(F("  Y:"));                    Serial.println(worldY, 1);

      buildDriveQueue(tx, ty);
      driveQueueIdx = 0;
      startNextPhase();
      return;
    }

    if (payload.indexOf("\"action\":\"recall\"") >= 0) {
      Serial.println(F("[WS] RECALL — Emergency Stop."));
      motors(0, 0);
      driveQueueLen = 0; driveQueueIdx = 0;
      state = WAITING;
      printBanner("MISSION ABORTED — WAITING");
    }
    if (payload.indexOf("\"type\":\"set_pos\"") >= 0) {
      int xi = payload.indexOf("\"x_cm\":");
      int yi = payload.indexOf("\"y_cm\":");
      if (xi >= 0 && yi >= 0) {
        worldX = payload.substring(xi + 7).toFloat();
        worldY = payload.substring(yi + 7).toFloat();
        Serial.print(F("[WS] Position synced implicitly to X:"));
        Serial.print(worldX, 1);
        Serial.print(F(" Y:"));
        Serial.println(worldY, 1);
      }
      return;
    }
  }
  
}

void wsTask(void*) { while (1) { ws.loop(); vTaskDelay(10); } }

// ─────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────
void setFault() { state = FAULT; }

void printSeparator() {
  Serial.println(F("------------------------------------------------------------"));
}

void printBanner(const char* title) {
  Serial.println(); printSeparator();
  Serial.print(F("  ")); Serial.println(title);
  printSeparator();
}

float phaseElapsed() {
  return (millis() - phaseStartTime) / 1000.0f;
}

void resetHeadingState() {
  heading = 0.0f; lastGyroTime = 0; lastHeadingErr = 0.0f;
}

void updateWorldPosAfterForward() {
  float moved = (distTraveled > 1.0f) ? distTraveled : currentDriveDist;
  switch (discreteHeading) {
    case 0: worldY += moved; break;
    case 1: worldX += moved; break;
    case 2: worldY -= moved; break;
    case 3: worldX -= moved; break;
  }
  Serial.print(F("[POS] World: X=")); Serial.print(worldX, 1);
  Serial.print(F("  Y="));            Serial.println(worldY, 1);
}

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  printBanner("ESP32 LUNAROBOT STARTING");
  Serial.println(F("  FORWARD : screwSpin()    — both motors same direction"));
  Serial.println(F("  TURN    : motors()        — direct opposite drive"));
  printSeparator();

  motorsInit();
  sonarInit();
  pinMode(AIR_QUALITY_DO, INPUT);
  Wire.begin();
  dht.begin();

  if (!mpu.begin()) {
    Serial.println(F("[ERROR] MPU6050 not found — halting!"));
    while (1);
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_10_HZ);
  Serial.println(F("[INIT] MPU6050 configured."));
  calibrateMPU();

  printBanner("ULTRASONIC SELF-TEST");
  float sonarSum = 0;
  for (int i = 0; i < 5; i++) {
    float r = readSonarCm(); sonarSum += r;
    Serial.print(F("  Reading ")); Serial.print(i + 1);
    Serial.print(F(": ")); Serial.print(r, 1); Serial.println(F(" cm"));
    delay(100);
  }
  float sonarAvg = sonarSum / 5.0f;
  Serial.print(F("  Average : ")); Serial.print(sonarAvg, 1); Serial.println(F(" cm"));
  Serial.println(sonarAvg >= SONAR_MAX_CM - 1.0f
    ? F("  [WARN] Nothing detected — dead-reckoning will be used.")
    : F("  [OK] Sonar healthy."));
  printSeparator();

  Serial.println(F("[WIFI] Connecting... (will retry until hotspot is on)"));
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    for (int i = 0; i < 20; i++) {
      if (WiFi.status() == WL_CONNECTED) break;
      delay(500); Serial.print(F("."));
    }
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println(F("\n[WIFI] Not found — retrying..."));
      WiFi.disconnect(); delay(2000);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
  Serial.println();
  Serial.print(F("[WIFI] Connected. IP: ")); Serial.println(WiFi.localIP());

  String url = "/data?token=" + String(AUTH_KEY);
  ws.begin(SERVER_ADDRESS, SERVER_PORT, url.c_str());
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(3000);
  xTaskCreatePinnedToCore(wsTask, "ws", 4096, NULL, 1, NULL, 0);
  Serial.print(F("[WS] Connecting to "));
  Serial.print(SERVER_ADDRESS); Serial.print(F(":")); Serial.println(SERVER_PORT);

  telTimer = logTimer = millis();
  state = WAITING;
  printBanner("WAITING FOR GOTO COMMAND");
  Serial.println(F("  Robot is ready. Press Deploy in the app to begin."));
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

  // ── Drive Forward ─────────────────────────────────────────
  //    screwSpin() = both motors same direction = actual travel
  case DRIVE_FWD: {
    float sonarNow   = readSonarCm();
    bool  sonarValid = (sonarNow < SONAR_MAX_CM - 1.0f && sonarNow > 2.0f);

    // ── Emergency stop: wall closer than 5 cm unexpectedly ──
    if (sonarValid && sonarNow < 5.0f && currentDriveDist > 5.0f) {
      motors(0, 0);
      Serial.println(F("[ESTOP] Too close to wall! Halting."));
      state = FAULT;
      break;
    }

    if (!sonarValid) {
      // Dead-reckoning: ~20 cm/s → 1 cm ≈ 50 ms
      unsigned long needed = (unsigned long)(currentDriveDist * 50.0f);
      if (now - phaseStartTime >= needed) {
        motors(0, 0);
        distTraveled = currentDriveDist;
        updateWorldPosAfterForward();
        driveQueueIdx++;
        startNextPhase();
      } else {
        screwSpin(-DRIVE_SPEED); // ← FORWARD
      }
      break;
    }

    distTraveled = sonarStart - sonarNow;
    if (distTraveled < 0) distTraveled = 0;
    bool arrived = distTraveled >= (currentDriveDist - ARRIVE_TOLERANCE_CM);

    if (now - logTimer >= 400) {
      Serial.print(F("[DRIVE] traveled:")); Serial.print(distTraveled, 1);
      Serial.print(F("  target:"));         Serial.print(currentDriveDist, 1);
      Serial.print(F("  remaining:"));      Serial.print(currentDriveDist - distTraveled, 1);
      Serial.print(F("  sonar:"));          Serial.println(sonarNow, 1);
    }

    if (arrived) {
      motors(0, 0);
      updateWorldPosAfterForward();
      driveQueueIdx++;
      startNextPhase();
    } else {
      screwSpin(-DRIVE_SPEED); // ← FORWARD
    }
    break;
  }

  // ── Turn ──────────────────────────────────────────────────
  //    direct motors() = pure rotation
  case TURN: {
    float targetRad = currentTurnDir * currentTurnDeg * PI / 180.0f;
    float remaining = targetRad - heading;
    bool  turnDone  = fabsf(remaining) <= (TURN_TOLERANCE_DEG * PI / 180.0f);

    if (now - logTimer >= 400) {
      Serial.print(F("[TURN] turned:"));    Serial.print(heading    * 180.0f / PI, 1);
      Serial.print(F("  remaining:"));      Serial.println(remaining * 180.0f / PI, 1);
    }

    if (turnDone) {
      motors(0, 0);
      delay(200);
      if (currentTurnDeg > 91.0f) {
        discreteHeading = (discreteHeading + 2) % 4;           // 180°
      } else {
        if (currentTurnDir > 0) discreteHeading = (discreteHeading + 3) % 4; // CCW
        else                    discreteHeading = (discreteHeading + 1) % 4; // CW
      }
      printBanner("TURN COMPLETE");
      Serial.print(F("  New discrete heading: ")); Serial.println(discreteHeading);
      driveQueueIdx++;
      startNextPhase();
    } else {
      // Proportional reduction in turn speed to prevent inertia overshoot
      float remDeg = fabsf(remaining * 180.0f / PI);
      int speed = TURN_SPEED;
      
      // If we are within 30 degrees of the target, start slowing down
      if (remDeg < 30.0f) {
        // map remaining degrees from (0 to 30) into Motor Speed (100 to TURN_SPEED)
        // 100 is chosen as a safe minimum speed to guarantee it overcomes static friction
        speed = 100 + (int)((remDeg / 30.0f) * (TURN_SPEED - 100));
      }
      
      if (currentTurnDir > 0) motors(speed, -speed);
      else                    motors(-speed, speed);
    }
    break;
  }

  // ── Sampling ──────────────────────────────────────────────
  case SAMPLING: {
    motors(0, 0);
    static unsigned long lastSampleTime = 0;
    if (now - lastSampleTime >= 250) {
      float t = dht.readTemperature();
      float h = dht.readHumidity();
      if (!isnan(t) && !isnan(h)) {
        sampleTempSum += t;
        sampleHumSum  += h;
        sampleAirSum  += analogRead(AIR_QUALITY_AO);
        sampleCount++;
      }
      lastSampleTime = now;
    }
    if (now - sampleStart >= SAMPLE_DURATION_MS) {
      driveQueueIdx++;
      startNextPhase();
    }
    break;
  }

  case FAULT:
    motors(0, 0);
    if (now - logTimer >= 5000)
      Serial.println(F("[FAULT] Halted. Power cycle to restart."));
    break;

  case WAITING:
  case CALIB:
  default:
    motors(0, 0);
    break;
  }

  if (now - logTimer >= 400) logTimer = now;
  delay(10);
}