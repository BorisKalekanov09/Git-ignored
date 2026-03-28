#pragma once

// ── WiFi / Server ─────────────────────────────────────────────
#define WIFI_SSID        "YOUR_SSID"
#define WIFI_PASSWORD    "YOUR_PASSWORD"
#define SERVER_ADDRESS   "YOUR_SERVER_IP"
#define SERVER_PORT      8080
#define AUTH_KEY         "YOUR_AUTH_KEY"
#define DEVICE_ID        "robot-01"

// ── Motor Pins (L298N) ────────────────────────────────────────
#define IN1 25
#define IN2 14
#define ENA 33
#define IN3 13
#define IN4 26
#define ENB 27

// ── Sensor Pins ───────────────────────────────────────────────
#define DHTPIN          5
#define DHTTYPE         DHT11
#define AIR_QUALITY_AO  39
#define AIR_QUALITY_DO  34

// ── Controller drive tuning ───────────────────────────────────
#define AXIS_MAX          512
#define STICK_DEADZONE    30
#define MAX_MOTOR_SPEED   255

// ── Screw drive tuning ────────────────────────────────────────
// The dominant screw gets full requested speed.
// The opposing screw gets this fraction in REVERSE to help push.
// 0.0 = opposing motor fully off (pure sideways)
// 0.4 = opposing motor 40% reverse (good starting point)
// Tune this up/down to get more/less forward bite.
#define SCREW_OPPOSE_RATIO  0.7f

// ── Sampling ──────────────────────────────────────────────────
#define SAMPLE_DURATION_MS 2500
