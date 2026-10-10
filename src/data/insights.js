// Friendly, plain-language views of session history for the Home and
// Progress screens (week view, streak, greeting, score wording).
import { countSessions } from "./scoring";

export const WEEKLY_GOAL = 5;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function hasSessionOn(sessions, day) {
  const start = day.getTime();
  const end = addDays(day, 1).getTime();
  return sessions.some((s) => s.timestamp >= start && s.timestamp < end);
}

// Monday-first week containing `now`.
export function weekOverview(sessions, now = new Date()) {
  const today = startOfDay(now);
  const todayIndex = (today.getDay() + 6) % 7;
  const monday = addDays(today, -todayIndex);

  const days = DAY_NAMES.map((label, i) => {
    const day = addDays(monday, i);
    return {
      label,
      dayNum: day.getDate(),
      done: hasSessionOn(sessions, day),
      isToday: i === todayIndex,
    };
  });

  const sessionsThisWeek = countSessions(sessions.filter((s) => s.timestamp >= monday.getTime()));
  return { days, sessionsThisWeek };
}

// Consecutive days with a session, counting back from today (or from
// yesterday, so a streak isn't "lost" before you've had a chance today).
export function currentStreak(sessions, now = new Date()) {
  let day = startOfDay(now);
  if (!hasSessionOn(sessions, day)) day = addDays(day, -1);
  let count = 0;
  while (hasSessionOn(sessions, day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

export function statusText(connectionState, demoMode) {
  if (connectionState === "connected") return demoMode ? "Demo mode" : "Connected";
  if (connectionState === "connecting") return "Connecting…";
  return "Not connected";
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function scoreBand(score) {
  if (score === null) {
    return { label: "Getting started", tone: "flat", message: "Play a few more sessions and we'll show how you're trending." };
  }
  if (score >= 65) {
    return { label: "Great progress", tone: "good", message: "Your grip and wrist are clearly getting stronger. Wonderful work!" };
  }
  if (score >= 55) {
    return { label: "Improving", tone: "good", message: "You're heading in the right direction. Keep it up!" };
  }
  if (score >= 45) {
    return { label: "Holding steady", tone: "flat", message: "About the same as before. Staying consistent is what counts." };
  }
  return { label: "Room to grow", tone: "low", message: "A little lower than before. A few short sessions will help." };
}

export function comparisonLabel(range) {
  return range.days === Infinity ? "vs your earlier sessions" : `vs previous ${range.label}`;
}

export function friendlyDate(timestamp, now = new Date()) {
  const day = startOfDay(timestamp).getTime();
  const today = startOfDay(now).getTime();
  if (day === today) return "Today";
  if (day === addDays(today, -1).getTime()) return "Yesterday";
  return new Date(timestamp).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
