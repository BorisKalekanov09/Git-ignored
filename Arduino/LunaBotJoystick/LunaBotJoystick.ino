// ============================================================
//  ESP32 LunaRobot — PS4 Controller Drive
//
//  PS4 left stick  → drive (forward/back)
//  PS4 right stick → spin (left/right)
//  Cross button    → trigger sampling + send cell_complete
//  Circle button   → emergency stop
//
//  Server still sends: {"action":"recall"} to halt.
//  Robot still sends:  "cell_complete" with sensor averages.
// ============================================================

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <Bluepad32.h>
#include "hardware.h"

// ─────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────
enum State { WAITING, DRIVING, SAMPLING, FAULT };
State state = WAITING;

// ─────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────
ControllerPtr connectedController = nullptr;

// ─────────────────────────────────────────────────────────────
// Sampling
// ─────────────────────────────────────────────────────────────
unsigned long sampleStart   = 0;
float sampleTempSum         = 0.0f;
float sampleHumSum          = 0.0f;
float sampleAirSum          = 0.0f;
int   sampleCount           = 0;

// ─────────────────────────────────────────────────────────────
// Timers
// ─────────────────────────────────────────────────────────────
float worldX = 0.0f;
float worldY = 0.0f;
unsigned long telTimer = 0;
unsigned long logTimer = 0;
unsigned long moveTimer = 0;

// ─────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────
WebSocketsClient ws;

void sendCellComplete() {
  float avgTemp = (sampleCount > 0) ? (sampleTempSum / sampleCount) : dht.readTemperature();
  float avgHum  = (sampleCount > 0) ? (sampleHumSum  / sampleCount) : dht.readHumidity();
  float avgAir  = (sampleCount > 0) ? (sampleAirSum  / sampleCount) : analogRead(AIR_QUALITY_AO);
  int   digAir  = digitalRead(AIR_QUALITY_DO);

  String msg = "{\"type\":\"cell_complete\""
               ",\"x_cm\":"        + String(worldX, 1) +
               ",\"y_cm\":"        + String(worldY, 1) +
               ",\"temperature\":" + String(avgTemp, 2) +
               ",\"humidity\":"    + String(avgHum, 2)  +
               ",\"air_quality\":" + String(avgAir, 2)  +
               ",\"air_digital\":" + String(digAir)     +
               "}";
  ws.sendTXT(msg);
  Serial.println(F("[CELL] cell_complete sent."));
  Serial.print(F("       Avg temp=")); Serial.print(avgTemp, 1);
  Serial.print(F("  Avg hum="));       Serial.println(avgHum, 1);
}

void sendTelemetry() {
  String msg = "{\"device_id\":\""  + String(DEVICE_ID) + "\""
             + ",\"x\":"            + String(worldX, 1)
             + ",\"y\":"            + String(worldY, 1)
             + ",\"temperature\":"  + String(dht.readTemperature(), 1)
             + ",\"humidity\":"     + String(dht.readHumidity(), 1)
             + ",\"air_quality\":"  + String(analogRead(AIR_QUALITY_AO))
             + ",\"air_digital\":"  + String(digitalRead(AIR_QUALITY_DO))
             + ",\"latitude\":"     + String(worldY, 4)
             + ",\"longitude\":"    + String(worldX, 4)
             + ",\"state\":\""      + String(state == DRIVING  ? "driving"  :
                                             state == SAMPLING ? "sampling" :
                                             state == FAULT    ? "fault"    : "waiting") + "\""
             + "}";
  ws.sendTXT(msg);
}

void wsEvent(WStype_t type, uint8_t* p, size_t len) {
  if (type == WStype_CONNECTED)    Serial.println(F("[WS] Connected to server."));
  if (type == WStype_DISCONNECTED) Serial.println(F("[WS] Disconnected from server."));

  if (type == WStype_TEXT) {
    String payload = (char*)p;
    if (payload.indexOf("\"action\":\"recall\"") >= 0) {
      Serial.println(F("[WS] RECALL — Emergency Stop."));
      motors(0, 0);
      state = WAITING;
      printBanner("MISSION ABORTED — WAITING");
    }

    if (payload.indexOf("\"type\":\"set_pos\"") >= 0) {
      int xi = payload.indexOf("\"x_cm\":");
      int yi = payload.indexOf("\"y_cm\":");
      if (xi >= 0 && yi >= 0) {
        worldX = payload.substring(xi + 7).toFloat();
        worldY = payload.substring(yi + 7).toFloat();
        Serial.print(F("[WS] Position synced to X:"));
        Serial.print(worldX, 1);
        Serial.print(F(" Y:"));
        Serial.println(worldY, 1);
      }
    }
  }
}

void wsTask(void*) { while (1) { ws.loop(); vTaskDelay(10); } }

// ─────────────────────────────────────────────────────────────
// Bluepad32 callbacks
// ─────────────────────────────────────────────────────────────
void onConnectedController(ControllerPtr ctl) {
  if (connectedController == nullptr) {
    connectedController = ctl;
    Serial.println(F("[BP32] PS4 controller connected."));
    ControllerProperties props = ctl->getProperties();
    Serial.print(F("       Address: "));
    for (int i = 0; i < 6; i++) {
      if (props.btaddr[i] < 0x10) Serial.print(F("0"));
      Serial.print(props.btaddr[i], HEX);
      if (i < 5) Serial.print(F(":"));
    }
    Serial.println();
  } else {
    Serial.println(F("[BP32] Extra controller ignored (only one supported)."));
    ctl->disconnect();
  }
}

void onDisconnectedController(ControllerPtr ctl) {
  if (connectedController == ctl) {
    connectedController = nullptr;
    motors(0, 0);
    Serial.println(F("[BP32] PS4 controller disconnected — motors stopped."));
  }
}

// ─────────────────────────────────────────────────────────────
// Controller processing
// ─────────────────────────────────────────────────────────────
void applyControllerDrive(ControllerPtr ctl) {
  int throttle = applyDeadzone(-ctl->axisY());   // left stick  up/down
  int spin     = applyDeadzone( ctl->axisRX());  // right stick left/right

  int forward = map(throttle, -AXIS_MAX, AXIS_MAX, -MAX_MOTOR_SPEED, MAX_MOTOR_SPEED);
  int turn    = map(spin,     -AXIS_MAX, AXIS_MAX, -MAX_MOTOR_SPEED, MAX_MOTOR_SPEED);

  screwDrive(forward, turn);

  if (millis() - logTimer >= 400) {
    Serial.print(F("[DRIVE] fwd=")); Serial.print(forward);
    Serial.print(F("  spin="));     Serial.println(turn);
  }
}

void processController() {
  ControllerPtr ctl = connectedController;
  if (!ctl || !ctl->isConnected()) {
    motors(0, 0);
    return;
  }

  // Circle → emergency stop
  if (ctl->b()) {
    motors(0, 0);
    state = WAITING;
    Serial.println(F("[BTN] Circle — Emergency stop."));
    return;
  }

  // Cross → start sampling
  if (ctl->a() && state != SAMPLING) {
    motors(0, 0);
    sampleTempSum = 0.0f;
    sampleHumSum  = 0.0f;
    sampleAirSum  = 0.0f;
    sampleCount   = 0;
    sampleStart   = millis();
    state         = SAMPLING;
    printBanner("SAMPLING — hold still...");
    return;
  }

  // Sticks → drive or idle
  int throttle = applyDeadzone(-ctl->axisY());
  int spin     = applyDeadzone( ctl->axisRX());

  if (throttle != 0 || spin != 0) {
    state = DRIVING;
    applyControllerDrive(ctl);
  } else {
    motors(0, 0);
    state = WAITING;
  }
}

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  printBanner("ESP32 LUNAROBOT — PS4 MODE");
  Serial.println(F("  Drive      : PS4 controller via Bluepad32"));
  Serial.println(F("  Sensors    : DHT11 + air quality"));
  Serial.println(F("  Controls   : L-stick fwd/back, R-stick spin"));
  Serial.println(F("               Cross=sample  Circle=e-stop"));
  Serial.println(F("  Mixing     : Archimedes screw dominance drive"));
  Serial.println(F("  Tune       : SCREW_OPPOSE_RATIO in config.h"));
  Serial.println(F("--------------------------------------------"));

  motorsInit();
  pinMode(AIR_QUALITY_DO, INPUT);
  dht.begin();
  Serial.println(F("[INIT] DHT11 ready."));

  BP32.setup(&onConnectedController, &onDisconnectedController);
  BP32.forgetBluetoothKeys();
  Serial.println(F("[BP32] Bluetooth ready — press PS button on controller."));

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
      WiFi.disconnect();
      delay(2000);
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
  Serial.print(F("[WS] Connecting to ")); Serial.print(SERVER_ADDRESS);
  Serial.print(F(":")); Serial.println(SERVER_PORT);

  telTimer = logTimer = millis();
  state = WAITING;
  printBanner("READY — WAITING FOR CONTROLLER");
}

// ─────────────────────────────────────────────────────────────
// Loop
// ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  BP32.update();

  if (now - telTimer >= 3000) { sendTelemetry(); telTimer = now; }

  switch (state) {

  case WAITING:
  case DRIVING:
    processController();
    break;

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
      sendCellComplete();
      state = WAITING;
      printBanner("SAMPLE DONE — WAITING");
    }
    break;
  }

  case FAULT:
    motors(0, 0);
    if (now - logTimer >= 5000)
      Serial.println(F("[FAULT] Halted. Power cycle to restart."));
    break;
  }

  if (now - logTimer >= 400) logTimer = now;
  delay(10);
}