#include "hardware.h"
#include <Arduino.h>

// ── Shared hardware objects ───────────────────────────────────
DHT dht(DHTPIN, DHTTYPE);

// ─────────────────────────────────────────────────────────────
// Motors
// ─────────────────────────────────────────────────────────────
void motorsInit() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); pinMode(ENA, OUTPUT);
  pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT); pinMode(ENB, OUTPUT);
  digitalWrite(IN1, LOW); digitalWrite(IN2, LOW); analogWrite(ENA, 0);
  digitalWrite(IN3, LOW); digitalWrite(IN4, LOW); analogWrite(ENB, 0);
  Serial.println(F("[INIT] Motor pins configured. Motors stopped."));
}

// Raw motor write — no mixing logic here, just direction + speed
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
// Screw drive mixing
//
//  Screw layout (top view):
//
//       [ LEFT screw ]====>   <====[ RIGHT screw ]
//              ^                        ^
//         faces right               faces left
//
//  To go FORWARD:
//    Left  screw dominant → full requested speed
//    Right screw helper   → partial reverse (SCREW_OPPOSE_RATIO)
//
//  To SPIN:
//    Both screws same direction → robot rotates
// ─────────────────────────────────────────────────────────────
void screwDrive(int forward, int spin) {
  if (forward == 0 && spin == 0) {
    motors(0, 0);
    return;
  }

  int leftSpeed  = 0;
  int rightSpeed = 0;

  if (forward != 0 && spin == 0) {
    // Pure forward/back — dominant + partial opposing
    leftSpeed  =  forward;
    rightSpeed = -(int)(forward * SCREW_OPPOSE_RATIO);

  } else if (spin != 0 && forward == 0) {
    // Pure spin — both same direction
    leftSpeed  = spin;
    rightSpeed = spin;

  } else {
    // Combined forward + spin — blend them
    int fwdL =  forward;
    int fwdR = -(int)(forward * SCREW_OPPOSE_RATIO);
    leftSpeed  = constrain(fwdL + spin, -MAX_MOTOR_SPEED, MAX_MOTOR_SPEED);
    rightSpeed = constrain(fwdR + spin, -MAX_MOTOR_SPEED, MAX_MOTOR_SPEED);
  }

  motors(
    constrain(leftSpeed,  -MAX_MOTOR_SPEED, MAX_MOTOR_SPEED),
    constrain(rightSpeed, -MAX_MOTOR_SPEED, MAX_MOTOR_SPEED)
  );
}

// ─────────────────────────────────────────────────────────────
// Controller helpers
// ─────────────────────────────────────────────────────────────
int applyDeadzone(int value) {
  return (abs(value) < STICK_DEADZONE) ? 0 : value;
}

// ─────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────
void printBanner(const char* title) {
  Serial.println();
  Serial.println(F("--------------------------------------------"));
  Serial.print(F("  ")); Serial.println(title);
  Serial.println(F("--------------------------------------------"));
}