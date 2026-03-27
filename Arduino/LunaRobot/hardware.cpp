#include "hardware.h"
#include <Arduino.h>
#include <Wire.h>
#include <math.h>

// ── Hardware objects ──────────────────────────────────────────
Adafruit_MPU6050 mpu;
DHT              dht(DHTPIN, DHTTYPE);

// ── Shared state ──────────────────────────────────────────────
float        calibGzOffset  = 0.0f;
float        heading        = 0.0f;
float        lastHeadingErr = 0.0f;
unsigned long lastGyroTime  = 0;

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
// Motors
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

  // ── NORMAL wiring ──────────────────────────────────────────
  digitalWrite(IN1, l >= 0 ? HIGH : LOW);
  digitalWrite(IN2, l >= 0 ? LOW  : HIGH);
  analogWrite(ENA, abs(l));

  digitalWrite(IN3, r >= 0 ? HIGH : LOW);
  digitalWrite(IN4, r >= 0 ? LOW  : HIGH);
  analogWrite(ENB, abs(r));

  // ── REVERSED wiring (uncomment if robot goes backward) ─────
  // digitalWrite(IN1, l >= 0 ? LOW  : HIGH);
  // digitalWrite(IN2, l >= 0 ? HIGH : LOW);
  // analogWrite(ENA, abs(l));
  // digitalWrite(IN3, r >= 0 ? LOW  : HIGH);
  // digitalWrite(IN4, r >= 0 ? HIGH : LOW);
  // analogWrite(ENB, abs(r));
}

// ─────────────────────────────────────────────────────────────
// Ultrasonic
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
  // Insertion sort → median
  for (int i = 1; i < SONAR_SAMPLES; i++) {
    float key = buf[i]; int j = i - 1;
    while (j >= 0 && buf[j] > key) { buf[j+1] = buf[j]; j--; }
    buf[j+1] = key;
  }
  float val = buf[SONAR_SAMPLES / 2];
  return (val > SONAR_MAX_CM) ? SONAR_MAX_CM : val;
}

bool sonarStartCheck(float reading, const char* phaseName,
                     void (*setFault)()) {
  if (reading >= SONAR_MAX_CM - 1.0f || reading <= 2.0f) {
    motors(0, 0);
    Serial.println();
    printSeparator();
    Serial.print(F("  [FAULT] No wall detected before ")); Serial.println(phaseName);
    Serial.print(F("  Sonar reading was: ")); Serial.print(reading, 1); Serial.println(F(" cm"));
    Serial.println(F("  Cannot navigate without a wall in range. Halting."));
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

// ─────────────────────────────────────────────────────────────
// Drive straight (PD heading lock)
// Correction sign: positive error → steer left → slow left, speed right.
// ─────────────────────────────────────────────────────────────
void driveStraight(float headingTarget) {
  float err        = headingTarget - heading;
  float correction = HEADING_KP * err + HEADING_KD * (err - lastHeadingErr);
  lastHeadingErr   = err;

  int leftSpeed  = constrain((int)(DRIVE_SPEED - correction), 0, 255);
  int rightSpeed = constrain((int)(DRIVE_SPEED + correction), 0, 255);
  motors(leftSpeed, rightSpeed);
}