#pragma once

#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include "config.h"

// ── Shared hardware objects (defined in hardware.cpp) ─────────
extern Adafruit_MPU6050 mpu;
extern DHT              dht;

// ── Shared state written by hardware drivers ──────────────────
extern float calibGzOffset;
extern float heading;
extern float lastHeadingErr;
extern unsigned long lastGyroTime;

// ── Motors ────────────────────────────────────────────────────
void motorsInit();
void motors(int l, int r);

// ── Ultrasonic ────────────────────────────────────────────────
void  sonarInit();
float readSonarCm();

// Returns true if reading is usable.
// Sets the robot to FAULT state and halts if no wall is detected.
bool sonarStartCheck(float reading, const char* phaseName,
                     void (*setFault)());

// ── Gyro / heading ────────────────────────────────────────────
void  calibrateMPU();
float readGz();
void  updateHeading();

// ── Drive straight (PD heading lock) ─────────────────────────
void driveStraight(float headingTarget);

// ── DHT (temperature / humidity) ─────────────────────────────
// Initialised alongside mpu in calibrateMPU(); use dht directly.