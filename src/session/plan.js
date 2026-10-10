import { GAMES } from "../data/games";

// Today's guided session: the games in order, and what each step is for.
export const TODAY_PLAN = [
  { gameId: "squeeze-pop", purpose: "Warm up your grip" },
  { gameId: "tilt-maze", purpose: "Loosen up your wrist" },
  { gameId: "balloon-rescue", purpose: "Put grip and wrist together" },
].map((step) => ({ ...step, game: GAMES.find((g) => g.id === step.gameId) }));

export const PLAN_MINUTES = TODAY_PLAN.reduce((sum, s) => sum + (s.game?.minutes ?? 2), 0);

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
