import { useSyncExternalStore } from "react";
import { getActiveProfile, getActiveId, subscribeProfiles, updateProfile } from "./profiles";

// Which hand the player is training
let fallback = "right"; // only used before anyone is set up (e.g. a guest)

export function getHand() {
  return getActiveProfile()?.hand ?? fallback;
}

export function setHand(next) {
  const hand = next === "left" ? "left" : "right";
  const id = getActiveId();
  if (id) updateProfile(id, { hand });
  else fallback = hand;
}

// Changes when the hand changes or a different person is chosen
export const subscribeHand = subscribeProfiles;

export function useHand() {
  return useSyncExternalStore(subscribeHand, getHand);
}

// Older sessions were all recorded before this setting existed: right hand
export const sessionHand = (s) => s.hand ?? "right";
