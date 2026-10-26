import { GAMES } from "../data/games";
import { activeKey } from "../data/profiles";

// Today's guided session: the games the player picked
export const MIN_PLAN_GAMES = 2;
const planKey = () => activeKey("planGames");
export const DEFAULT_PLAN_IDS = ["squeeze-pop", "tilt-maze", "balloon-rescue", "fishing"];

// What each game is for, shown in the session
const PURPOSE = {
  "squeeze-pop": "Warm up your grip",
  "tilt-maze": "Loosen up your wrist",
  garden: "Steady grip, gentle tilt",
  "balloon-rescue": "Put grip and wrist together",
  fishing: "Every move, one at a time",
};

export const PLAYABLE_GAMES = GAMES.filter((g) => g.playable);
const isPlayable = (id) => PLAYABLE_GAMES.some((g) => g.id === id);

// Game ids -> session steps
export const planFrom = (ids) =>
  ids
    .filter(isPlayable)
    .map((gameId) => ({ gameId, purpose: PURPOSE[gameId] ?? "", game: GAMES.find((g) => g.id === gameId) }));

export const planMinutes = (plan) => plan.reduce((sum, s) => sum + (s.game?.minutes ?? 2), 0);

const savedIds = {}; // per person (storage key -> ids)

export function getPlanIds() {
  const key = planKey();
  if (!(key in savedIds)) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      const ids = Array.isArray(parsed) ? parsed.filter(isPlayable) : [];
      savedIds[key] = ids.length >= MIN_PLAN_GAMES ? ids : DEFAULT_PLAN_IDS.filter(isPlayable);
    } catch {
      savedIds[key] = DEFAULT_PLAN_IDS.filter(isPlayable);
    }
  }
  return savedIds[key];
}

export function savePlanIds(ids) {
  const key = planKey();
  savedIds[key] = ids.filter(isPlayable);
  try {
    localStorage.setItem(key, JSON.stringify(savedIds[key]));
  } catch {
    // Storage blocked: remembered for this visit only
  }
}

// "Done for today" is remembered per person and local calendar day
const doneKey = () => activeKey("planDone");
let demoDoneDate = null;

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function isPlanDoneToday(demoMode) {
  if (demoMode) return demoDoneDate === todayKey();
  try {
    return localStorage.getItem(doneKey()) === todayKey();
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
    localStorage.setItem(doneKey(), todayKey());
  } catch {
    // Storage blocked: Home just won't show "done for today"
  }
}

export const newSessionId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
