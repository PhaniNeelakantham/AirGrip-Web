import { useSyncExternalStore } from "react";

// Guest mode: someone tries AquaGrip on the real device and nothing is kept.
// No sessions are saved, and their baseline lives in memory only until
// "Next guest" (or Guest mode is turned off). The owner's saved data is
// never touched. The switch itself is remembered so a page reload in the
// middle of a demo stays in Guest mode.
const GUEST_KEY = "aquagrip.guest";
let guest; // undefined = not loaded yet
let run = 0; // bumps for each new guest, which forgets the last one's baseline
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export function getGuest() {
  if (guest === undefined) {
    try {
      guest = localStorage.getItem(GUEST_KEY) === "on";
    } catch {
      guest = false;
    }
  }
  return guest;
}

export const getGuestRun = () => run;

export function setGuest(on) {
  guest = Boolean(on);
  run++;
  try {
    if (guest) localStorage.setItem(GUEST_KEY, "on");
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    // Storage blocked: remembered for this visit only.
  }
  notify();
}

export function nextGuest() {
  run++;
  notify();
}

export function subscribeGuest(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useGuest() {
  return useSyncExternalStore(subscribeGuest, getGuest);
}

// Results-card line for a game that wasn't saved.
export const notSavedText = (demoMode) =>
  demoMode ? "Demo game, not saved to your progress." : "Guest game, not saved to anyone's progress.";
