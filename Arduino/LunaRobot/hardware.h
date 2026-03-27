#pragma once
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include "config.h"

// ── Shared hardware objects ───────────────────────────────────
extern Adafruit_MPU6050 mpu;
extern DHT              dht;

// ── Shared state ──────────────────────────────────────────────
extern float         calibGzOffset;
extern float         heading;
extern float         lastHeadingErr;
extern unsigned long lastGyroTime;

// ── Motors ────────────────────────────────────────────────────
void motorsInit();
void motors(int l, int r);

// ── Screw drive primitives ────────────────────────────────────
// screwForward: dominant motor full, helper motor partial reverse.
//   speed > 0 = forward,  speed < 0 = backward
// screwSpin: both motors same direction = rotate in place.
//   speed > 0 = CCW (left),  speed < 0 = CW (right)
void screwForward(int speed);
void screwSpin(int speed);

// ── Drive straight using screw mixing + PD heading lock ───────
void driveStraight(float headingTarget, int dir);

// ── Ultrasonic ────────────────────────────────────────────────
void  sonarInit();
float readSonarCm();
bool  sonarStartCheck(float reading, const char* phaseName,
                      void (*setFault)());

// ── Gyro / heading ────────────────────────────────────────────
void  calibrateMPU();
float readGz();
void  updateHeading();