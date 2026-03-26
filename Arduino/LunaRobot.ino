// ============================================================
//  ESP32 LunaRobot
// ============================================================

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <math.h>

// ── Config ───────────────────────────────────────────────────
const char* ssid          = "Mino";
const char* password      = "AGoodPass";
const char* serverAddress = "10.17.114.173";
const int   serverPort    = 8080;
const char* AUTH_KEY      = "4775f0fb31998501257ac92598380e2f";
const char* DEVICE_ID     = "robot-01";   // <-- change this

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
#define CM_PER_SECOND      20.0f   // calibrate: cm traveled in 1s at BASE_SPEED
#define WAYPOINT_RADIUS_CM 15.0f
#define BASE_SPEED         180
#define KP                 2.5f

// ── Waypoints (cm) ───────────────────────────────────────────
struct Waypoint { float x, y; };
Waypoint path[] = { {0,0}, {0,5}, {5,10}, {5,20} };
const int TOTAL_WP = sizeof(path) / sizeof(path[0]);
int wpIndex = 1;

// ── State machine ─────────────────────────────────────────────
enum State { DRIVING, STOPPED, DONE };
State state = DRIVING;
unsigned long stopTimer = 0;

// ── Position ──────────────────────────────────────────────────
float posX = 0, posY = 0, heading = 0;
unsigned long lastUpdate = 0;
int currentL = 0, currentR = 0;

// ── Objects ───────────────────────────────────────────────────
Adafruit_MPU6050 mpu;
DHT dht(DHTPIN, DHTTYPE);
WebSocketsClient ws;
unsigned long telTimer = 0;

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

void updatePos() {
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);

  unsigned long now = millis();
  float dt = (now - lastUpdate) / 1000.0f;
  lastUpdate = now;
  if (dt <= 0 || dt > 0.5f) return;

  heading += g.gyro.z * (180.0f / PI) * dt;

  if (abs(currentL) > 50 || abs(currentR) > 50) {
    float avgPwm = (abs(currentL) + abs(currentR)) / 2.0f;
    float dist   = CM_PER_SECOND * (avgPwm / BASE_SPEED) * dt;
    posX += dist * sinf(heading * PI / 180.0f);
    posY += dist * cosf(heading * PI / 180.0f);
  }
}

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

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nWiFi OK");

  String url = "/data?token=" + String(AUTH_KEY);
  ws.beginSSL(serverAddress, serverPort, url.c_str());
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(3000);
  xTaskCreatePinnedToCore(wsTask, "ws", 4096, NULL, 1, NULL, 0);

  lastUpdate = telTimer = millis();
}

// ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  updatePos();

  // Telemetry every 3s
  if (now - telTimer >= 3000) {
    float speed = CM_PER_SECOND * ((abs(currentL) + abs(currentR)) / 2.0f) / BASE_SPEED;

    String msg = "{\"device_id\":\"" + String(DEVICE_ID)              + "\""
               + ",\"wp\":"          + String(wpIndex)
               + ",\"x\":"           + String(posX, 1)
               + ",\"y\":"           + String(posY, 1)
               + ",\"temperature\":" + String(dht.readTemperature(), 1)
               + ",\"humidity\":"    + String(dht.readHumidity(), 1)
               + ",\"latitude\":"    + String(posY, 4) // mapping Y/X to Lat/Lon for simplicity
               + ",\"longitude\":"   + String(posX, 4)
               + ",\"speed\":"       + String(speed, 1)
               + "}";

    ws.sendTXT(msg);
    Serial.println(msg);
    telTimer = now;
  }

  switch (state) {

    case DRIVING: {
      if (wpIndex >= TOTAL_WP) { motors(0,0); state = DONE; break; }

      float dx   = path[wpIndex].x - posX;
      float dy   = path[wpIndex].y - posY;
      float dist = sqrtf(dx*dx + dy*dy);

      if (dist < WAYPOINT_RADIUS_CM) {
        motors(0,0); stopTimer = now; state = STOPPED;
        Serial.printf("Waypoint %d reached\n", wpIndex);
        break;
      }

      float desired = atan2f(dx, dy) * (180.0f / PI);
      float err = desired - heading;
      while (err >  180) err -= 360;
      while (err < -180) err += 360;

      float corr = constrain(KP * err, -255.0f, 255.0f);
      motors(constrain((int)(BASE_SPEED + corr), -255, 255),
             constrain((int)(BASE_SPEED - corr), -255, 255));
      break;
    }

    case STOPPED:
      if (now - stopTimer >= 5000) { wpIndex++; state = DRIVING; }
      break;

    case DONE:
      motors(0,0);
      break;
  }

  delay(10);
}