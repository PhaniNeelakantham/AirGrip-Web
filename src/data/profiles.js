import { useSyncExternalStore } from "react";

// People who use AquaGrip on this device. Everything personal -- baselines,
// grip range, session picks, progress -- belongs to the active profile.
// All of it is stored on this device only (localStorage); nothing is sent
// anywhere unless the person exports their progress.
//
//   aquagrip.profiles.v1   -> [{ id, name, color, hand, weeklyGoal, ageRange, createdAt }]
//   aquagrip.activeProfile -> id of the person playing now
//   aquagrip.p.<id>.<name> -> that person's own data (see profileKey)
//   sessions               -> one shared list, each tagged with its profileId

const PROFILES_KEY = "aquagrip.profiles.v1";
const ACTIVE_KEY = "aquagrip.activeProfile";

export const AVATAR_COLORS = ["#5b6cf0", "#12b3a5", "#f2994a", "#e85d8a", "#8b5cf6", "#2f9e44"];
export const AGE_RANGES = ["Under 50", "50–64", "65–79", "80+"];
export const WEEKLY_GOALS = [3, 5, 7];
export const DEFAULT_WEEKLY_GOAL = 5;

let profiles; // undefined = not loaded yet
let activeId = null;
const listeners = new Set();
let snapshot = null;
const notify = () => {
  snapshot = null;
  listeners.forEach((fn) => fn());
};

const newId = () => `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function save() {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Storage blocked: kept for this visit only.
  }
}

// Before profiles existed, everything was saved for one unnamed person.
// The first time this version runs, that data becomes a profile called
// "Me", so nobody loses their baseline or progress. (The old keys are left
// in place, untouched, as a safety copy.)
function migrate() {
  const read = (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const old = {
    sessions: read("aquagrip.sessions.v1"),
    baselineRight: read("aquagrip.baseline.v1"),
    baselineLeft: read("aquagrip.baseline.left.v1"),
    calRight: read("aquagrip.gripCalibration.v1"),
    calLeft: read("aquagrip.gripCalibration.left.v1"),
    planGames: read("aquagrip.planGames.v1"),
    planDone: read("aquagrip.planDoneDate"),
    hand: read("aquagrip.hand"),
  };
  let sessions = [];
  try {
    sessions = JSON.parse(old.sessions ?? "[]");
  } catch {
    sessions = [];
  }
  const hasData =
    (Array.isArray(sessions) && sessions.length > 0) || old.baselineRight || old.baselineLeft || old.calRight || old.calLeft;
  if (!hasData) return []; // a brand-new install: the first screen sets someone up

  const me = {
    id: newId(),
    name: "Me",
    color: AVATAR_COLORS[0],
    hand: old.hand === "left" ? "left" : "right",
    weeklyGoal: DEFAULT_WEEKLY_GOAL,
    ageRange: null,
    createdAt: Date.now(),
  };
  const put = (name, value) => {
    if (value === null) return;
    try {
      localStorage.setItem(profileKey(me.id, name), value);
    } catch {
      // Storage blocked: nothing to migrate into.
    }
  };
  put("baseline.right", old.baselineRight);
  put("baseline.left", old.baselineLeft);
  put("calibration.right", old.calRight);
  put("calibration.left", old.calLeft);
  put("planGames", old.planGames);
  put("planDone", old.planDone);
  if (Array.isArray(sessions) && sessions.length) {
    try {
      localStorage.setItem(
        "aquagrip.sessions.v1",
        JSON.stringify(sessions.map((s) => (s.profileId ? s : { ...s, profileId: me.id })))
      );
    } catch {
      // Storage blocked: sessions without an owner count as the first profile.
    }
  }
  activeId = me.id;
  return [me];
}

function load() {
  if (profiles !== undefined) return;
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILES_KEY));
    if (Array.isArray(parsed)) {
      profiles = parsed;
      activeId = localStorage.getItem(ACTIVE_KEY);
    } else {
      profiles = migrate();
      save();
    }
  } catch {
    profiles = [];
  }
  if (!profiles.some((p) => p.id === activeId)) activeId = profiles[0]?.id ?? null;
}

export function getProfiles() {
  load();
  return profiles;
}

export function getActiveId() {
  load();
  return activeId;
}

export function getActiveProfile() {
  load();
  return profiles.find((p) => p.id === activeId) ?? null;
}

// Storage key for one person's own data, e.g. their right-hand baseline.
// With nobody set up yet (only possible before the first profile is
// created) it falls back to a shared spot.
export function profileKey(id, name) {
  return `aquagrip.p.${id ?? "none"}.${name}`;
}
export const activeKey = (name) => profileKey(getActiveId(), name);

export function setActiveProfile(id) {
  load();
  if (!profiles.some((p) => p.id === id)) return;
  activeId = id;
  save();
  notify();
}

export function addProfile(fields) {
  load();
  const p = {
    id: newId(),
    name: (fields.name ?? "").trim() || "Me",
    color: fields.color ?? AVATAR_COLORS[profiles.length % AVATAR_COLORS.length],
    hand: fields.hand === "left" ? "left" : "right",
    weeklyGoal: fields.weeklyGoal ?? DEFAULT_WEEKLY_GOAL,
    ageRange: fields.ageRange ?? null,
    createdAt: Date.now(),
  };
  profiles = [...profiles, p];
  activeId = p.id;
  save();
  notify();
  return p.id;
}

export function updateProfile(id, patch) {
  load();
  profiles = profiles.map((p) => (p.id === id ? { ...p, ...patch, name: (patch.name ?? p.name).trim() || p.name } : p));
  save();
  notify();
}

// Removes the person and everything saved for them on this device.
export function deleteProfile(id) {
  load();
  profiles = profiles.filter((p) => p.id !== id);
  try {
    const prefix = profileKey(id, "");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) localStorage.removeItem(k);
    }
    const sessions = JSON.parse(localStorage.getItem("aquagrip.sessions.v1") ?? "[]");
    if (Array.isArray(sessions)) {
      localStorage.setItem("aquagrip.sessions.v1", JSON.stringify(sessions.filter((s) => s.profileId !== id)));
    }
  } catch {
    // Storage blocked: nothing saved to remove.
  }
  if (activeId === id) activeId = profiles[0]?.id ?? null;
  save();
  notify();
}

export function subscribeProfiles(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  load();
  if (!snapshot) snapshot = { profiles, active: profiles.find((p) => p.id === activeId) ?? null };
  return snapshot;
}

// { profiles, active }
export function useProfiles() {
  return useSyncExternalStore(subscribeProfiles, getSnapshot);
}

export const weeklyGoalOf = (profile) => profile?.weeklyGoal ?? DEFAULT_WEEKLY_GOAL;
// Sessions saved before profiles existed belong to the first profile.
export const sessionOwner = (s, list) => s.profileId ?? list[0]?.id ?? null;

export const initialsOf = (name) =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
