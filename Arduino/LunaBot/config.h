#pragma once

// ── WiFi / Server ─────────────────────────────────────────────
#define WIFI_SSID        "Mino"
#define WIFI_PASSWORD    "AGoodPass"
#define SERVER_ADDRESS   "10.17.114.173"
#define SERVER_PORT      8080
#define AUTH_KEY         "e4d2c8f1a5b9d3c7b2e1f4a9d6e8b4c2"
#define DEVICE_ID        "robot-01"

// ── Motor Pins (L298N) ────────────────────────────────────────
#define IN1 25
#define IN2 14
#define ENA 33
#define IN3 13
#define IN4 26
#define ENB 27

// ── Sensor Pins ───────────────────────────────────────────────
#define DHTPIN   5
#define DHTTYPE  DHT11
#define TRIG_PIN 32
#define ECHO_PIN 35
#define AIR_QUALITY_AO 39
#define AIR_QUALITY_DO 34

// ── Mission targets ───────────────────────────────────────────
#define TARGET_Y_CM  50.0f
#define TARGET_X_CM  30.0f

// ── Arrival tolerance ─────────────────────────────────────────
#define ARRIVE_TOLERANCE_CM 2.5f

// ── Turn ──────────────────────────────────────────────────────
#define TURN_DIRECTION     1
#define TURN_DEGREES       90.0f
#define TURN_TOLERANCE_DEG 1.2f

// ── Speeds ────────────────────────────────────────────────────
#define DRIVE_SPEED  200
#define TURN_SPEED   250

// ── Screw drive ───────────────────────────────────────────────
// Dominant motor runs at DRIVE_SPEED forward.
// Helper motor runs at DRIVE_SPEED * this ratio in REVERSE.
// 0.0 = helper fully off (pure one-motor)
// 0.4 = helper pushes back 40% to aid forward motion
// Tune up in 0.1 steps if not moving enough forward.
#define SCREW_OPPOSE_RATIO 0.3f

// ── Heading PD controller ─────────────────────────────────────
// Note: heading correction now only affects the dominant motor
// speed since the helper motor is always at fixed oppose ratio.
#define HEADING_KP 40.0f
#define HEADING_KD  5.0f

// ── Calibration ───────────────────────────────────────────────
#define CALIB_SAMPLES 300

// ── Ultrasonic ────────────────────────────────────────────────
// Sonar faces the direction of travel (the "sideways" axis
// of the screws = the robot's actual forward direction).
// Dead-reckoning fallback: rough cm/ms for DRIVE_SPEED=250.
#define SONAR_MAX_CM   300.0f
#define SONAR_SAMPLES  5
#define CM_PER_MS      0.020f   // tune: ~20cm/s at full speed