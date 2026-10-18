import { getHand } from "./hand";
import { getGuest, getGuestRun } from "./guest";
import { getDevMode } from "./devMode";

// The player's grip range from the Baseline assessment: relaxed reading and
// comfortable max, in psi, for each hand. Real calibration is saved in this
// browser; demo calibration lives in memory only, since demo data is never
// saved. (The right hand keeps the original key, from before hands existed.)
const keyFor = (hand) => (hand === "left" ? "aquagrip.gripCalibration.left.v1" : "aquagrip.gripCalibration.v1");
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
  if (!(hand in saved)) {
    try {
      const parsed = JSON.parse(localStorage.getItem(keyFor(hand)));
      saved[hand] = isValid(parsed) ? parsed : null;
    } catch {
      saved[hand] = null;
    }
  }
  return saved[hand];
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
  saved[hand] = calibration;
  try {
    localStorage.setItem(keyFor(hand), JSON.stringify(calibration));
  } catch {
    // Storage blocked -- keep it for this visit only.
  }
}
