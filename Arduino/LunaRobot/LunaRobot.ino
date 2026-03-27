// ============================================================
//  ESP32 LunaRobot — Cell-to-Cell Autonomous Navigation
//
//  Server sends: {"type":"goto","x_cm":30.0,"y_cm":50.0}
//  Robot drives there from its current position, stays 2-3s,
//  collects sensor data, then sends "cell_complete" back.
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
  DRIVE_FWD,    // drive currentDriveDist cm forward
  TURN,         // turn currentTurnDeg degrees in currentTurnDir
  SAMPLING,     // stationary at cell centre, collecting sensor readings
  FAULT
};
State state = CALIB;

// ─────────────────────────────────────────────────────────────
// Mission state
// ─────────────────────────────────────────────────────────────
// World position in cm (float, robot-centric)
float worldX = 0.0f;
float worldY = 0.0f;
// Current absolute heading angle: 0 = "forward / +Y"
// Robot always starts pointing in the +Y direction.
// heading accumulates turn angle in RADIANS (positive = CCW / left).
// We also track a discrete heading for cell navigation:
//   0 = +Y (forward)  1 = +X (right)  2 = -Y (back)  3 = -X (left)
int discreteHeading = 0; // 0=+Y, 1=+X, 2=-Y, 3=-X

float distTraveled    = 0.0f;
float sonarStart      = 0.0f;
float currentDriveDist = 0.0f;
float currentTurnDeg   = 90.0f;
int   currentTurnDir   = 1;   // 1 = left(CCW), -1 = right(CW)

// Pending goto target (in cm, absolute world coordinates)
float gotoX = 0.0f;
float gotoY = 0.0f;
bool  gotoPending = false;

// Action queue for decomposed movements
// We decompose a goto into at most: [turn?, forward]
// Implemented as a tiny state sequence.
enum DrivePhase { PH_NONE, PH_TURN, PH_FORWARD, PH_SAMPLE };
DrivePhase driveQueue[3];
int        driveQueueLen = 0;
int        driveQueueIdx = 0;

// Sampling
unsigned long sampleStart = 0;
#define SAMPLE_DURATION_MS 2500  // stay ~2.5 seconds
float   sampleTempSum  = 0.0f;
float   sampleHumSum   = 0.0f;
int     sampleCount    = 0;

unsigned long telTimer       = 0;
unsigned long logTimer       = 0;
unsigned long phaseStartTime = 0;

// ─────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────
WebSocketsClient ws;

void sendCellComplete() {
  float avgTemp = (sampleCount > 0) ? (sampleTempSum / sampleCount) : dht.readTemperature();
  float avgHum  = (sampleCount > 0) ? (sampleHumSum  / sampleCount) : dht.readHumidity();
  String msg = "{\"type\":\"cell_complete\""
               ",\"x_cm\":"     + String(worldX, 1) +
               ",\"y_cm\":"     + String(worldY, 1) +
               ",\"temperature\":" + String(avgTemp, 2) +
               ",\"humidity\":"    + String(avgHum, 2) +
               "}";
  ws.sendTXT(msg);
  Serial.println(F("[CELL] cell_complete sent to server."));
  Serial.print(F("       Avg temp=")); Serial.print(avgTemp, 1);
  Serial.print(F("  Avg hum=")); Serial.println(avgHum, 1);
}

void sendTelemetry() {
  String msg = "{\"device_id\":\""   + String(DEVICE_ID)   + "\""
             + ",\"x\":"             + String(worldX, 1)
             + ",\"y\":"             + String(worldY, 1)
             + ",\"heading_deg\":"   + String(heading * 180.0f / PI, 1)
             + ",\"temperature\":"   + String(dht.readTemperature(), 1)
             + ",\"humidity\":"      + String(dht.readHumidity(), 1)
             + ",\"latitude\":"      + String(worldY, 4)
             + ",\"longitude\":"     + String(worldX, 4)
             + "}";
  ws.sendTXT(msg);
}

// ─────────────────────────────────────────────────────────────
// Navigation helpers
// ─────────────────────────────────────────────────────────────

// Returns the number of 90° CCW steps needed to go from `from` to `to`
// (returns 0,1,2,3)
int headingDiff(int from, int to) {
  return (to - from + 4) % 4;
}

// Given current discreteHeading and desired heading, pick the shorter turn.
// Sets currentTurnDeg, currentTurnDir, currentTurnDeg.
// Returns true if a turn is needed.
bool planTurn(int desiredHeading) {
  int diff = headingDiff(discreteHeading, desiredHeading);
  if (diff == 0) return false;
  if (diff == 1) {
    // 1 step CCW = left turn
    currentTurnDir = 1;
    currentTurnDeg = 90.0f;
  } else if (diff == 3) {
    // 3 steps CCW = 1 step CW = right turn
    currentTurnDir = -1;
    currentTurnDeg = 90.0f;
  } else {
    // diff == 2: 180° — always turn right for consistency
    currentTurnDir = -1;
    currentTurnDeg = 180.0f;
  }
  return true;
}

// Compute what movements are needed to reach (tx, ty) from (worldX, worldY).
// We navigate purely in one axis at a time (L-shaped or straight).
// Order: first correct X, then Y (or whichever is non-zero).
void buildDriveQueue(float tx, float ty) {
  driveQueueLen = 0;
  driveQueueIdx = 0;

  float dx = tx - worldX;
  float dy = ty - worldY;

  // ── Step 1: horizontal (X) movement if needed ──
  if (fabsf(dx) > ARRIVE_TOLERANCE_CM) {
    int desiredH = (dx > 0) ? 1 : 3; // +X = heading 1, -X = heading 3
    if (planTurn(desiredH)) {
      driveQueue[driveQueueLen++] = PH_TURN;
    }
    driveQueue[driveQueueLen++] = PH_FORWARD;
    // after this forward, discreteHeading will be desiredH
    // Store what we'll drive and heading update in startNextPhase()
  }

  // ── Step 2: vertical (Y) movement if needed ──
  if (fabsf(dy) > ARRIVE_TOLERANCE_CM) {
    // (We'll re-evaluate at runtime since dx may have changed heading)
    driveQueue[driveQueueLen++] = PH_FORWARD; // placeholder; handled in startNextPhase
  }

  // ── Step 3: sample at destination ──
  driveQueue[driveQueueLen++] = PH_SAMPLE;
}

// ─────────────────────────────────────────────────────────────
// Phase executor — called when we need to start the next phase
// ─────────────────────────────────────────────────────────────
void startNextPhase();

void startPhase(DrivePhase ph) {
  float dx = gotoX - worldX;
  float dy = gotoY - worldY;

  switch (ph) {

    case PH_TURN: {
      // Re-derive desired heading based on remaining delta
      int desiredH;
      if (fabsf(dx) > ARRIVE_TOLERANCE_CM) {
        desiredH = (dx > 0) ? 1 : 3;
      } else {
        desiredH = (dy > 0) ? 0 : 2;
      }
      if (!planTurn(desiredH)) {
        // No turn needed — skip
        driveQueueIdx++;
        startNextPhase();
        return;
      }
      resetHeadingState();
      phaseStartTime = millis();
      state = TURN;
      printBanner("PHASE: TURN");
      break;
    }

    case PH_FORWARD: {
      // Decide distance based on which axis we're driving
      float dist;
      // If we're heading along X axis:
      if (discreteHeading == 1 || discreteHeading == 3) {
        dist = fabsf(dx);
      } else {
        dist = fabsf(dy);
      }
      if (dist < ARRIVE_TOLERANCE_CM) {
        // Nothing to drive — skip
        driveQueueIdx++;
        startNextPhase();
        return;
      }
      currentDriveDist = dist;
      distTraveled     = 0.0f;
      sonarStart       = readSonarCm();
      resetHeadingState();
      phaseStartTime = millis();
      state = DRIVE_FWD;
      printBanner("PHASE: DRIVE FORWARD");
      Serial.print(F("  Target dist: ")); Serial.print(dist, 1); Serial.println(F(" cm"));
      break;
    }

    case PH_SAMPLE: {
      motors(0, 0);
      sampleTempSum  = 0.0f;
      sampleHumSum   = 0.0f;
      sampleCount    = 0;
      sampleStart    = millis();
      state          = SAMPLING;
      printBanner("PHASE: SAMPLING AT CELL");
      break;
    }

    default:
      break;
  }
}

void startNextPhase() {
  if (driveQueueIdx >= driveQueueLen) {
    // All phases done
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

    // ── goto command: {"type":"goto","x_cm":30.0,"y_cm":50.0} ──
    if (payload.indexOf("\"type\":\"goto\"") >= 0 && state == WAITING) {
      // Parse x_cm and y_cm with simple string scanning
      int xi = payload.indexOf("\"x_cm\":");
      int yi = payload.indexOf("\"y_cm\":");
      if (xi < 0 || yi < 0) return;

      float tx = payload.substring(xi + 7).toFloat();
      float ty = payload.substring(yi + 7).toFloat();

      gotoX = tx;
      gotoY = ty;

      Serial.println();
      Serial.print(F("[WS] GOTO command → target X:")); Serial.print(tx, 1);
      Serial.print(F(" cm   Y:")); Serial.print(ty, 1); Serial.println(F(" cm"));
      Serial.print(F("       Current world X:")); Serial.print(worldX, 1);
      Serial.print(F("  Y:")); Serial.println(worldY, 1);

      buildDriveQueue(tx, ty);
      driveQueueIdx = 0;
      startNextPhase();
      return;
    }

    // ── recall: emergency stop ──
    if (payload.indexOf("\"action\":\"recall\"") >= 0) {
      Serial.println(F("[WS] RECALL — Emergency Stop."));
      motors(0, 0);
      driveQueueLen = 0;
      driveQueueIdx = 0;
      state = WAITING;
      printBanner("MISSION ABORTED — WAITING");
    }
  }
}

void wsTask(void*) { while (1) { ws.loop(); vTaskDelay(10); } }

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
  Serial.println(F("  Navigation : Cell-to-Cell via server GOTO commands"));
  Serial.println(F("  Sensors    : MPU6050 gyro + HC-SR04 ultrasonic + DHT11"));
  printSeparator();

  motorsInit();
  sonarInit();

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

  // Sonar self-test
  printBanner("ULTRASONIC SELF-TEST");
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
    Serial.println(F("  [WARN] No object detected ahead."));
  else
    Serial.println(F("  [OK] Sonar healthy."));
  printSeparator();

  // WiFi
  Serial.println(F("[WIFI] Connecting..."));
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int wifiTries = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(F("."));
    if (++wifiTries > 30) { Serial.println(F("\n[WIFI] Timeout.")); break; }
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
  case DRIVE_FWD: {
    float sonarNow = readSonarCm();

    // No wall in range — dead-reckoning fallback
    if (sonarNow >= SONAR_MAX_CM - 1.0f || sonarNow <= 2.0f) {
      // Estimate time needed: DRIVE_SPEED ~= 0.2 m/s (rough)
      // 20cm/s → 1cm takes ~50ms
      unsigned long needed = (unsigned long)(currentDriveDist * 50.0f);
      if (now - phaseStartTime >= needed) {
        motors(0, 0);
        // Update world position
        updateWorldPosAfterForward();
        driveQueueIdx++;
        startNextPhase();
      } else {
        driveStraight(0.0f);
      }
      break;
    }

    distTraveled = sonarStart - sonarNow;
    if (distTraveled < 0) distTraveled = 0;
    bool arrived = distTraveled >= (currentDriveDist - ARRIVE_TOLERANCE_CM);

    if (now - logTimer >= 400) {
      Serial.print(F("[DRIVE] traveled:")); Serial.print(distTraveled, 1);
      Serial.print(F("  target:")); Serial.print(currentDriveDist, 1);
      Serial.print(F("  remaining:")); Serial.println(currentDriveDist - distTraveled, 1);
    }

    if (arrived) {
      motors(0, 0);
      updateWorldPosAfterForward();
      driveQueueIdx++;
      startNextPhase();
    } else {
      driveStraight(0.0f);
    }
    break;
  }

  // ── Turn ──────────────────────────────────────────────────
  case TURN: {
    float targetRad = currentTurnDir * currentTurnDeg * PI / 180.0f;
    float turned    = heading;
    float remaining = targetRad - turned;
    bool  turnDone  = fabsf(remaining) <= (TURN_TOLERANCE_DEG * PI / 180.0f);

    if (now - logTimer >= 400) {
      Serial.print(F("[TURN] turned:")); Serial.print(turned * 180.0f / PI, 1);
      Serial.print(F("  remaining:")); Serial.println(remaining * 180.0f / PI, 1);
    }

    if (turnDone) {
      motors(0, 0);
      delay(200);
      // Update discrete heading
      if (currentTurnDir > 0) {
        discreteHeading = (discreteHeading + 3) % 4; // CCW = left
      } else {
        discreteHeading = (discreteHeading + 1) % 4; // CW = right
      }
      if (currentTurnDeg > 91.0f) {
        // 180° turn — apply twice
        discreteHeading = (discreteHeading + 1) % 4;
      }
      printBanner("TURN COMPLETE");
      driveQueueIdx++;
      startNextPhase();
    } else {
      if (currentTurnDir > 0) motors( TURN_SPEED, -TURN_SPEED);
      else                    motors(-TURN_SPEED,  TURN_SPEED);
    }
    break;
  }

  // ── Sampling ──────────────────────────────────────────────
  case SAMPLING: {
    motors(0, 0);
    // Collect a reading every ~250ms
    static unsigned long lastSampleTime = 0;
    if (now - lastSampleTime >= 250) {
      float t = dht.readTemperature();
      float h = dht.readHumidity();
      if (!isnan(t) && !isnan(h)) {
        sampleTempSum += t;
        sampleHumSum  += h;
        sampleCount++;
      }
      lastSampleTime = now;
    }
    if (now - sampleStart >= SAMPLE_DURATION_MS) {
      driveQueueIdx++;
      startNextPhase(); // Will hit PH_SAMPLE done → sendCellComplete
    }
    break;
  }

  // ── Fault ─────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Update worldX/worldY after a forward move completes
// ─────────────────────────────────────────────────────────────
void updateWorldPosAfterForward() {
  // Use actual distTraveled if sonar was valid, else currentDriveDist
  float moved = (distTraveled > 1.0f) ? distTraveled : currentDriveDist;
  switch (discreteHeading) {
    case 0: worldY += moved; break; // +Y
    case 1: worldX += moved; break; // +X
    case 2: worldY -= moved; break; // -Y
    case 3: worldX -= moved; break; // -X
  }
  Serial.print(F("[POS] World: X=")); Serial.print(worldX, 1);
  Serial.print(F("  Y=")); Serial.println(worldY, 1);
}