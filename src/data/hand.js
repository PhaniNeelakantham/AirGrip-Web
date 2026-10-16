import { useSyncExternalStore } from "react";

// Which hand the player is training. Each hand keeps its own baseline, grip
// range and progress, since the device sits mirrored in the other hand.
const HAND_KEY = "aquagrip.hand";
let hand; // undefined = not loaded yet
const listeners = new Set();

export function getHand() {
  if (hand === undefined) {
    try {
      hand = localStorage.getItem(HAND_KEY) === "left" ? "left" : "right";
    } catch {
      hand = "right";
    }
  }
  return hand;
}

export function setHand(next) {
  hand = next === "left" ? "left" : "right";
  try {
    localStorage.setItem(HAND_KEY, hand);
  } catch {
    // Storage blocked: remembered for this visit only.
  }
  listeners.forEach((fn) => fn());
}

export function subscribeHand(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useHand() {
  return useSyncExternalStore(subscribeHand, getHand);
}

// Older sessions were all recorded before this setting existed: right hand.
export const sessionHand = (s) => s.hand ?? "right";
