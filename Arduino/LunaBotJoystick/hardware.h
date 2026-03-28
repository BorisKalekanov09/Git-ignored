#pragma once

#include <DHT.h>
#include "config.h"

// ── Shared hardware objects ───────────────────────────────────
extern DHT dht;

// ── Motors ────────────────────────────────────────────────────
void motorsInit();
void motors(int l, int r);

// ── Screw drive mixing ────────────────────────────────────────
// forward: -255..255  (positive = forward)
// spin:    -255..255  (positive = CCW/left, negative = CW/right)
void screwDrive(int forward, int spin);

// ── Controller helpers ────────────────────────────────────────
int  applyDeadzone(int value);

// ── Utility ───────────────────────────────────────────────────
void printBanner(const char* title);