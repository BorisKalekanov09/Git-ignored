#pragma once

// ── WiFi / Server ─────────────────────────────────────────────
#define WIFI_SSID        "A1_F382"
#define WIFI_PASSWORD    "Kek4Thx7"
#define SERVER_ADDRESS   "192.168.100.43"
#define SERVER_PORT      8080
#define AUTH_KEY         "e4d2c8f1a5b9d3c7b2e1f4a9d6e8b4c2"
#define DEVICE_ID        "robot-01"

// ── Motor Pins (L298N) ────────────────────────────────────────
#define IN1 25
#define IN2 14
#define ENA 33
#define IN4 13
#define IN3 26
#define ENB 27

// ── Sensor Pins ───────────────────────────────────────────────
#define DHTPIN   5
#define DHTTYPE  DHT11
#define TRIG_PIN 32
#define ECHO_PIN 35

// ── Mission targets ───────────────────────────────────────────
#define TARGET_Y_CM  50.0f
#define TARGET_X_CM  30.0f

// ── Arrival tolerance ─────────────────────────────────────────
#define ARRIVE_TOLERANCE_CM 2.5f

// ── Turn ──────────────────────────────────────────────────────
#define TURN_DIRECTION     1        // 1 = left (CCW),  -1 = right (CW)
#define TURN_DEGREES       90.0f
#define TURN_TOLERANCE_DEG 2.0f

// ── Speeds ────────────────────────────────────────────────────
#define DRIVE_SPEED 250
#define TURN_SPEED  200

// ── Heading PD controller ─────────────────────────────────────
#define HEADING_KP 40.0f
#define HEADING_KD  5.0f

// ── Calibration ───────────────────────────────────────────────
#define CALIB_SAMPLES 300

// ── Ultrasonic ────────────────────────────────────────────────
#define SONAR_MAX_CM  300.0f
#define SONAR_SAMPLES 5