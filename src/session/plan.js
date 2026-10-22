import { GAMES } from "../data/games";

// Today's guided session: the games the player picked (at least 2), in the
// order they picked them. The choice is remembered in this browser.
export const MIN_PLAN_GAMES = 2;
const PLAN_KEY = "aquagrip.planGames.v1";
export const DEFAULT_PLAN_IDS = ["squeeze-pop", "tilt-maze", "balloon-rescue", "fishing"];

// What each game is for, shown in the session.
const PURPOSE = {
  "squeeze-pop": "Warm up your grip",
  "tilt-maze": "Loosen up your wrist",
  garden: "Steady grip, gentle tilt",
  "balloon-rescue": "Put grip and wrist together",
  fishing: "Every move, one at a time",
};

export const PLAYABLE_GAMES = GAMES.filter((g) => g.playable);
const isPlayable = (id) => PLAYABLE_GAMES.some((g) => g.id === id);

// Game ids -> session steps.
export const planFrom = (ids) =>
  ids
    .filter(isPlayable)
    .map((gameId) => ({ gameId, purpose: PURPOSE[gameId] ?? "", game: GAMES.find((g) => g.id === gameId) }));

export const planMinutes = (plan) => plan.reduce((sum, s) => sum + (s.game?.minutes ?? 2), 0);

let savedIds; // undefined = not loaded yet

export function getPlanIds() {
  if (savedIds === undefined) {
    try {
      const parsed = JSON.parse(localStorage.getItem(PLAN_KEY));
      const ids = Array.isArray(parsed) ? parsed.filter(isPlayable) : [];
      savedIds = ids.length >= MIN_PLAN_GAMES ? ids : DEFAULT_PLAN_IDS.filter(isPlayable);
    } catch {
      savedIds = DEFAULT_PLAN_IDS.filter(isPlayable);
    }
  }
  return savedIds;
}

export function savePlanIds(ids) {
  savedIds = ids.filter(isPlayable);
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(savedIds));
  } catch {
    // Storage blocked: remembered for this visit only.
  }
}

// "Done for today" is remembered per local calendar day. Real sessions
// are kept in this browser; demo sessions only for this visit, since demo
// data is never saved.
const DONE_KEY = "aquagrip.planDoneDate";
let demoDoneDate = null;

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function isPlanDoneToday(demoMode) {
  if (demoMode) return demoDoneDate === todayKey();
  try {
    return localStorage.getItem(DONE_KEY) === todayKey();
  } catch {
    return false;
  }
}

export function markPlanDone(demoMode) {
  if (demoMode) {
    demoDoneDate = todayKey();
    return;
  }
  try {
    localStorage.setItem(DONE_KEY, todayKey());
  } catch {
    // Storage blocked: Home just won't show "done for today".
  }
}

export const newSessionId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
