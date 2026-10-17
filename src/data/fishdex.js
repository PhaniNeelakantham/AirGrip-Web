import { useSyncExternalStore } from "react";

// The fish collection: how many of each species this browser has caught.
// Real catches are saved; Demo and Guest catches only count for this visit,
// like everything else they do.
const KEY = "aquagrip.fishdex.v1";
let saved; // undefined = not loaded yet
let visit = {}; // demo / guest catches
const listeners = new Set();

function load() {
  if (saved === undefined) {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY));
      saved = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      saved = {};
    }
  }
  return saved;
}

let snapshot = null;
function getSnapshot() {
  if (!snapshot) snapshot = { saved: load(), visit };
  return snapshot;
}

export function recordCatch(id, persist) {
  if (persist) {
    saved = { ...load(), [id]: (load()[id] ?? 0) + 1 };
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      // Storage blocked: counted for this visit only.
    }
  } else {
    visit = { ...visit, [id]: (visit[id] ?? 0) + 1 };
  }
  snapshot = null;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// The collection to show: saved catches, plus this visit's for Demo / Guest.
export function useFishdex(includeVisit) {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  if (!includeVisit) return snap.saved;
  const all = { ...snap.saved };
  for (const [id, n] of Object.entries(snap.visit)) all[id] = (all[id] ?? 0) + n;
  return all;
}

export function hasCaught(id, includeVisit) {
  return Boolean(load()[id] || (includeVisit && visit[id]));
}
