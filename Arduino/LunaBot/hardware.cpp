#include "hardware.h"
#include <Arduino.h>
#include <Wire.h>
#include <math.h>

// ── Hardware objects ──────────────────────────────────────────
Adafruit_MPU6050 mpu;
DHT              dht(DHTPIN, DHTTYPE);

// ── Shared state ──────────────────────────────────────────────
float         calibGzOffset  = 0.0f;
float         heading        = 0.0f;
float         lastHeadingErr = 0.0f;
unsigned long lastGyroTime   = 0;

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────
static void printSeparator() {
  Serial.println(F("------------------------------------------------------------"));
}
static void printBanner(const char* title) {
  Serial.println();
  printSeparator();
  Serial.print(F("  ")); Serial.println(title);
  printSeparator();
}

// ─────────────────────────────────────────────────────────────
// Motors — raw write, no mixing
// ─────────────────────────────────────────────────────────────
void motorsInit() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); pinMode(ENA, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT); pinMode(ENB, OUTPUT);
  motors(0, 0);
  Serial.println(F("[INIT] Motor pins configured. Motors stopped."));
}

void motors(int l, int r) {
  l = constrain(l, -255, 255);
  r = constrain(r, -255, 255);
  digitalWrite(IN1, l >= 0 ? HIGH : LOW);
  digitalWrite(IN2, l >= 0 ? LOW  : HIGH);
  analogWrite(ENA, abs(l));
  digitalWrite(IN3, r >= 0 ? HIGH : LOW);
  digitalWrite(IN4, r >= 0 ? LOW  : HIGH);
  analogWrite(ENB, abs(r));
}

// ─────────────────────────────────────────────────────────────
// Screw drive primitives
//
//  Physical layout (top view):
//
//    [LEFT screw] ====>    <==== [RIGHT screw]
//         faces right            faces left
//
//  From PS4 testing:
//    "Forward" = motors(SPEED, 0)      one motor dominant, other off/opposing
//    "Spin"    = motors(SPEED, SPEED)  both same direction
//
//  screwForward: left motor is dominant (sonar faces that side).
//    dominant = full speed forward
//    helper   = SCREW_OPPOSE_RATIO * speed in reverse
//
//  screwSpin: both motors same direction.
//    positive = CCW (left), negative = CW (right)
// ─────────────────────────────────────────────────────────────
void screwForward(int speed) {
  // speed: -255..255  (positive = forward)
  int dominant =  speed;
  int helper   = -(int)(speed * SCREW_OPPOSE_RATIO);
  motors(dominant, helper);
}

void screwSpin(int speed) {
  // speed: -255..255  (positive = CCW/left, negative = CW/right)
  motors(speed, speed);
}

// ─────────────────────────────────────────────────────────────
// Drive straight with PD heading lock
//
// The sonar is on the LEFT (dominant) motor side, which is the
// side that faces the direction of travel. The PD correction
// modulates only the dominant motor speed — the helper stays
// fixed at its oppose ratio so it doesn't fight the correction.
// ─────────────────────────────────────────────────────────────
void driveStraight(float headingTarget, int dir) {
  float err        = headingTarget - heading;
  float correction = HEADING_KP * err + HEADING_KD * (err - lastHeadingErr);
  lastHeadingErr   = err;

  int dominant = constrain((int)(TURN_SPEED + correction), 0, 255);
  int helper   = -(int)(dominant * SCREW_OPPOSE_RATIO);

  motors(dir * dominant, dir * helper);
}

// ─────────────────────────────────────────────────────────────
// Ultrasonic
// Sonar faces the LEFT motor side = the robot's travel direction
// ─────────────────────────────────────────────────────────────
void sonarInit() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  Serial.println(F("[INIT] Ultrasonic pins configured."));
}

static float readSonarOnce() {
  digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 25000);
  if (duration == 0) return SONAR_MAX_CM;
  return duration * 0.01716f;
}

float readSonarCm() {
  float buf[SONAR_SAMPLES];
  for (int i = 0; i < SONAR_SAMPLES; i++) { buf[i] = readSonarOnce(); delay(5); }
  for (int i = 1; i < SONAR_SAMPLES; i++) {
    float key = buf[i]; int j = i - 1;
    while (j >= 0 && buf[j] > key) { buf[j+1] = buf[j]; j--; }
    buf[j+1] = key;
  }
  float val = buf[SONAR_SAMPLES / 2];
  return (val > SONAR_MAX_CM) ? SONAR_MAX_CM : val;
}

bool sonarStartCheck(float reading, const char* phaseName, void (*setFault)()) {
  if (reading >= SONAR_MAX_CM - 1.0f || reading <= 2.0f) {
    motors(0, 0);
    Serial.println();
    printSeparator();
    Serial.print(F("  [FAULT] No wall detected before ")); Serial.println(phaseName);
    Serial.print(F("  Sonar reading: ")); Serial.print(reading, 1); Serial.println(F(" cm"));
    Serial.println(F("  Halting — cannot navigate without distance reference."));
    printSeparator();
    setFault();
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// MPU6050 calibration
// ─────────────────────────────────────────────────────────────
void calibrateMPU() {
  printBanner("MPU6050 CALIBRATION");
  Serial.println(F("  Keep robot completely still..."));
  motors(0, 0);
  delay(300);

  double sumGz = 0;
  for (int i = 0; i < CALIB_SAMPLES; i++) {
    sensors_event_t aE, gE, tE;
    mpu.getEvent(&aE, &gE, &tE);
    sumGz += gE.gyro.z;
    delay(4);
  }
  calibGzOffset = sumGz / CALIB_SAMPLES;

  Serial.print(F("  Samples taken : ")); Serial.println(CALIB_SAMPLES);
  Serial.print(F("  Gyro Z offset : ")); Serial.print(calibGzOffset, 5); Serial.println(F(" rad/s"));
  Serial.println(F("  Calibration complete."));
  printSeparator();
}

// ─────────────────────────────────────────────────────────────
// Gyro / heading
// ─────────────────────────────────────────────────────────────
float readGz() {
  sensors_event_t aE, gE, tE;
  mpu.getEvent(&aE, &gE, &tE);
  float gz = gE.gyro.z - calibGzOffset;
  if (fabsf(gz) < 0.005f) gz = 0.0f;
  return gz;
}

void updateHeading() {
  unsigned long now = millis();
  if (lastGyroTime == 0) { lastGyroTime = now; return; }
  float dt = (now - lastGyroTime) / 1000.0f;
  lastGyroTime = now;
  if (dt <= 0 || dt > 0.05f) return;
  heading += readGz() * dt;
}