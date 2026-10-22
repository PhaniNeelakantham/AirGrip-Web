import { getHand } from "./hand";
import { activeKey } from "./profiles";
import { getGuest, getGuestRun } from "./guest";
import { getDevMode } from "./devMode";

// The player's grip range from the Baseline assessment: relaxed reading and
// comfortable max, in psi, for each person and hand. Real calibration is
// saved on this device; demo calibration lives in memory only, since demo
// data is never saved.
const keyFor = (hand) => activeKey(`calibration.${hand}`);
const demoCalibration = {};
const saved = {};
const guestCalibration = { run: -1, byHand: {} }; // Guest mode: memory only

const guestStore = () => {
  if (guestCalibration.run !== getGuestRun()) Object.assign(guestCalibration, { run: getGuestRun(), byHand: {} });
  return guestCalibration.byHand;
};

// Demo mode can be played without a baseline: a pretend grip range that
// matches the pretend squeeze (Space bar / Hold button).
const DEMO_DEFAULT = { restPsi: 0, maxPsi: 8 };

const isValid = (c) =>
  c && Number.isFinite(c.restPsi) && Number.isFinite(c.maxPsi) && c.maxPsi > c.restPsi;

export function getCalibration(demoMode, hand = getHand()) {
  if (demoMode) return demoCalibration[hand] ?? null;
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

// Developer mode without a baseline: "relaxed" is the reading when the game
// starts, and this much above it counts as a full squeeze.
const DEV_SPAN_PSI = 6;

// What a grip game plays with: the real range; or with no baseline, the
// pretend default in Demo mode, or a default range in Developer mode
// (`restNow` = the live reading when the game starts).
export function getPlayCalibration(demoMode, restNow) {
  const cal = getCalibration(demoMode);
  if (cal) return cal;
  if (demoMode) return DEMO_DEFAULT;
  if (!getDevMode()) return null;
  const rest = Number.isFinite(restNow) && restNow > 0.5 ? restNow : 14.7;
  return { restPsi: rest, maxPsi: rest + DEV_SPAN_PSI };
}

export function saveCalibration(demoMode, calibration, hand = getHand()) {
  if (demoMode) {
    demoCalibration[hand] = calibration;
    return;
  }
  if (getGuest()) {
    guestStore()[hand] = calibration;
    return;
  }
  saved[keyFor(hand)] = calibration;
  try {
    localStorage.setItem(keyFor(hand), JSON.stringify(calibration));
  } catch {
    // Storage blocked -- keep it for this visit only.
  }
}
