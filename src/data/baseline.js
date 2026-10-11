import { useSyncExternalStore } from "react";
import { saveCalibration } from "./gripCalibration";

// The player's starting point from the Baseline assessment: grip range
// (relaxed + comfortable max, psi) and wrist range in each direction (degrees
// from "level": tilt = pitch, turn = roll, wave side to side = yaw; yaw
// fields are missing on baselines taken before it was added), plus which way the sensor reads for "up" and "right" on
// this player's device. Real results are saved in this browser; demo results
// only for this visit, since demo data is never saved.
const STORAGE_KEY = "aquagrip.baseline.v1";
let demoBaseline = null;
let saved; // undefined = not loaded yet
const listeners = new Set();

const isValid = (b) =>
  b &&
  ["restPsi", "maxPsi", "pitchUp", "pitchDown", "rollRight", "rollLeft"].every((k) => Number.isFinite(b[k])) &&
  b.maxPsi > b.restPsi;

export function getBaseline(demoMode) {
  if (demoMode) return demoBaseline;
  if (saved === undefined) {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      saved = isValid(parsed) ? parsed : null;
    } catch {
      saved = null;
    }
  }
  return saved;
}

export function saveBaseline(demoMode, baseline) {
  if (demoMode) {
    demoBaseline = baseline;
  } else {
    saved = baseline;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(baseline));
    } catch {
      // Storage blocked: kept for this visit only.
    }
  }
  // Grip games read their range from the grip calibration.
  saveCalibration(demoMode, { restPsi: baseline.restPsi, maxPsi: baseline.maxPsi, at: baseline.at });
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBaseline(demoMode) {
  return useSyncExternalStore(subscribe, () => getBaseline(demoMode));
}

// ---- Turning the baseline into game difficulty ----
const FULL_SPEED_FRACTION = 0.7; // full speed at 70% of the player's comfortable range
const MIN_FULL_DEG = 10; // never require less than this (noise would steer the ball)
const MAX_FULL_DEG = 40; // never require more than this (the default)
export const DEFAULT_FULL_DEG = 40;
export const DEFAULT_DEADZONE_DEG = 4;

const fullFor = (range) => Math.min(MAX_FULL_DEG, Math.max(MIN_FULL_DEG, range * FULL_SPEED_FRACTION));

// Tilt Maze tuning: the tilt needed for full speed in each screen direction,
// a matching dead zone, and which sensor direction is "up"/"right".
export function tiltTuning(baseline) {
  if (!baseline) {
    return {
      tuned: false,
      full: { up: DEFAULT_FULL_DEG, down: DEFAULT_FULL_DEG, left: DEFAULT_FULL_DEG, right: DEFAULT_FULL_DEG },
      deadzone: DEFAULT_DEADZONE_DEG,
      pitchUpSign: 1,
      rollRightSign: 1,
    };
  }
  const full = {
    up: fullFor(baseline.pitchUp),
    down: fullFor(baseline.pitchDown),
    left: fullFor(baseline.rollLeft),
    right: fullFor(baseline.rollRight),
  };
  const smallest = Math.min(full.up, full.down, full.left, full.right);
  return {
    tuned: true,
    full,
    deadzone: Math.min(DEFAULT_DEADZONE_DEG, Math.max(2.5, smallest * 0.15)),
    pitchUpSign: baseline.pitchUpSign ?? 1,
    rollRightSign: baseline.rollRightSign ?? 1,
  };
}

// Side-to-side (yaw) range is naturally smaller, and baselines taken before
// it was measured don't have it.
const DEFAULT_YAW_FULL_DEG = 20;
const yawFullFor = (range) =>
  Number.isFinite(range) ? Math.min(30, Math.max(8, range * FULL_SPEED_FRACTION)) : DEFAULT_YAW_FULL_DEG;

// All three wrist directions, for games that use tilt, turn and wave:
// the angle that counts as "all the way" (70% of the player's range) in
// each direction, and which sensor direction is up / right.
export function wristTuning(baseline) {
  const tilt = tiltTuning(baseline);
  return {
    ...tilt,
    yawFull: { right: yawFullFor(baseline?.yawRight), left: yawFullFor(baseline?.yawLeft) },
    yawRightSign: baseline?.yawRightSign ?? 1,
  };
}
