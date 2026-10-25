import { useSyncExternalStore } from "react";
import { saveCalibration } from "./gripCalibration";
import { getHand, subscribeHand } from "./hand";
import { activeKey } from "./profiles";
import { getGuest, getGuestRun, subscribeGuest } from "./guest";

// The player's starting point from the Baseline assessment
const keyFor = (hand) => activeKey(`baseline.${hand}`);
const demoBaseline = {};
const saved = {};
const guestBaseline = { run: -1, byHand: {} }; // Guest mode: memory only

const guestStore = () => {
  if (guestBaseline.run !== getGuestRun()) Object.assign(guestBaseline, { run: getGuestRun(), byHand: {} });
  return guestBaseline.byHand;
};
const listeners = new Set();

const isValid = (b) =>
  b &&
  ["restPsi", "maxPsi", "pitchUp", "pitchDown", "rollRight", "rollLeft"].every((k) => Number.isFinite(b[k])) &&
  b.maxPsi > b.restPsi;

export function getBaseline(demoMode, hand = getHand()) {
  if (demoMode) return demoBaseline[hand] ?? null;
  if (getGuest()) return guestStore()[hand] ?? null;
  const key = keyFor(hand);
  if (!(key in saved)) {
    try {
      const parsed = JSON.parse(localStorage.getItem(keyFor(hand)));
      saved[key] = isValid(parsed) ? parsed : null;
    } catch {
      saved[key] = null;
    }
  }
  return saved[key];
}

export function saveBaseline(demoMode, baseline, hand = getHand()) {
  if (demoMode) {
    demoBaseline[hand] = baseline;
  } else if (getGuest()) {
    guestStore()[hand] = baseline;
  } else {
    saved[keyFor(hand)] = baseline;
    try {
      localStorage.setItem(keyFor(hand), JSON.stringify(baseline));
    } catch {
      // Storage blocked: kept for this visit only
    }
  }
  // Grip games read their range from the grip calibration
  saveCalibration(demoMode, { restPsi: baseline.restPsi, maxPsi: baseline.maxPsi, at: baseline.at }, hand);
  listeners.forEach((fn) => fn());
}

// Also changes when the player switches hands or guests
function subscribe(fn) {
  listeners.add(fn);
  const offHand = subscribeHand(fn);
  const offGuest = subscribeGuest(fn);
  return () => {
    listeners.delete(fn);
    offHand();
    offGuest();
  };
}

export function useBaseline(demoMode) {
  return useSyncExternalStore(subscribe, () => getBaseline(demoMode));
}

// ---- Turning the baseline into game difficulty ----
const FULL_SPEED_FRACTION = 0.7; // full speed at 70% of the player's comfortable
const MIN_FULL_DEG = 10; // never require less than this
const MAX_FULL_DEG = 40; // never require more than this (the default)
export const DEFAULT_FULL_DEG = 40;
export const DEFAULT_DEADZONE_DEG = 4;

const fullFor = (range) => Math.min(MAX_FULL_DEG, Math.max(MIN_FULL_DEG, range * FULL_SPEED_FRACTION));

// Tilt Maze tuning: the tilt needed for full speed in each screen direction
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

// Side-to-side range is naturally smaller
const DEFAULT_YAW_FULL_DEG = 20;
const yawFullFor = (range) =>
  Number.isFinite(range) ? Math.min(30, Math.max(8, range * FULL_SPEED_FRACTION)) : DEFAULT_YAW_FULL_DEG;

// Tilt, turn and wave tuning for games that use all three
export function wristTuning(baseline) {
  const tilt = tiltTuning(baseline);
  return {
    ...tilt,
    yawFull: { right: yawFullFor(baseline?.yawRight), left: yawFullFor(baseline?.yawLeft) },
    // Default when not measured: waving right reads as negative yaw
    yawRightSign: baseline?.yawRightSign ?? -1,
  };
}
