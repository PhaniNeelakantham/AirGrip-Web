import { useSyncExternalStore } from "react";

// Developer mode: play the games on the real device without taking the baseline
const KEY = "aquagrip.devMode";
let on; // undefined = not loaded yet
const listeners = new Set();

export function getDevMode() {
  if (on === undefined) {
    try {
      on = localStorage.getItem(KEY) === "on";
    } catch {
      on = false;
    }
  }
  return on;
}

export function setDevMode(next) {
  on = Boolean(next);
  try {
    if (on) localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: remembered for this visit only
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useDevMode() {
  return useSyncExternalStore(subscribe, getDevMode);
}
