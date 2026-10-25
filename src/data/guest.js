import { useSyncExternalStore } from "react";

// Guest mode: someone tries AirGrip on the real device and nothing is kept
const GUEST_KEY = "aquagrip.guest";
let guest; // undefined = not loaded yet
let run = 0; // bumps for each new guest
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
    // Storage blocked: remembered for this visit only
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

// Results-card line for a game that wasn't saved
export const notSavedText = (demoMode) =>
  demoMode ? "Demo game, not saved to your progress." : "Guest game, not saved to anyone's progress.";
