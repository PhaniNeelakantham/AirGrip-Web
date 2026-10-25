import { averageOf, baselineForRange, countSessions, improvementScore, summarize } from "../data/scoring";
import { currentStreak, scoreBand, weekOverview } from "../data/insights";
import { ADVANCED_METRICS } from "../data/advancedMetrics";
import { GAMES } from "../data/games";

// Summary sent to the AI helper: numbers only, no profile details

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 60; // every game in this window is listed one by one
const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const fmt = (v, unit = "", d = 1) => (round(v, d) === null ? "no data" : `${round(v, d)}${unit}`);
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const weekday = (t) => new Date(t).toLocaleDateString("en-US", { weekday: "short" });
const gameName = (id) => GAMES.find((g) => g.id === id)?.name ?? "Unknown game";
const LEVEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

// Longest run of days in a row with at least one game
function longestStreak(sessions) {
  const days = [...new Set(sessions.map((s) => dayKey(s.timestamp)))].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    const t = new Date(`${d}T12:00:00`).getTime();
    run = prev !== null && Math.round((t - prev) / DAY_MS) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

// One line per game: what it measured
function describeSession(s) {
  const parts = [
    s.peakForcePsi != null ? `best squeeze ${round(s.peakForcePsi)} psi` : null,
    s.avgForcePsi != null ? `average squeeze ${round(s.avgForcePsi)} psi` : null,
    s.reps != null ? `${s.reps} squeezes` : null,
    s.rotationRangeDeg != null ? `wrist range ${Math.round(s.rotationRangeDeg)} degrees` : null,
    s.holdBestS != null ? `longest hold ${round(s.holdBestS)} s` : null,
    s.tremorDeg != null ? `wrist shake ${round(s.tremorDeg, 2)} degrees` : null,
    s.fishCaught != null ? `${s.fishCaught} fish` : null,
    s.durationS ? `${Math.max(1, Math.round(s.durationS / 60))} min` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

export function buildProgressSummary({ sessions, baseline, hand, weeklyGoal, demoMode }) {
  const now = Date.now();
  const lines = [];
  lines.push(`Today: ${dayKey(now)} (${weekday(now)}).`);
  if (demoMode) lines.push("NOTE: this is SAMPLE data from Demo mode, not a real person's history.");
  lines.push(`Hand being trained: ${hand}. Weekly goal: ${weeklyGoal} sessions a week.`);

  // ---- Game library ----
  lines.push("", "GAME LIBRARY (all AirGrip games):");
  for (const g of GAMES.filter((x) => x.playable)) {
    lines.push(`- ${g.name} (${LEVEL[g.level] ?? "Easy"}, about ${g.minutes} min, trains: ${g.trains}): ${g.desc}`);
  }

  if (!sessions.length) {
    lines.push("", "No games played yet.");
  } else {
    // ---- Streaks and consistency ----
    const { days, sessionsThisWeek } = weekOverview(sessions);
    lines.push(
      "",
      "STREAKS AND CONSISTENCY:",
      `- Current streak: ${currentStreak(sessions)} day(s) in a row. Longest streak ever: ${longestStreak(sessions)} day(s).`,
      `- This week (Monday to Sunday): ${sessionsThisWeek} of ${weeklyGoal} sessions. Days played: ${
        days
          .filter((d) => d.done)
          .map((d) => d.label)
          .join(", ") || "none yet"
      }.`
    );
    for (let w = 1; w <= 4; w++) {
      const end = now - (w - 1) * 7 * DAY_MS;
      const start = end - 7 * DAY_MS;
      const inWeek = sessions.filter((s) => s.timestamp >= start && s.timestamp < end);
      lines.push(
        `- ${w === 1 ? "Last 7 days" : `${w} weeks ago (7 days)`}: ${countSessions(inWeek)} sessions on ${
          new Set(inWeek.map((s) => dayKey(s.timestamp))).size
        } different days.`
      );
    }
    lines.push(
      `- All time: ${countSessions(sessions)} sessions (${sessions.length} games), first on ${dayKey(sessions[0].timestamp)}, most recent on ${dayKey(
        sessions[sessions.length - 1].timestamp
      )}.`
    );

    // ---- Overall trend ----
    const { current, baseline: before } = baselineForRange(sessions, 30, now);
    const nowS = summarize(current);
    const beforeS = summarize(before);
    const score = improvementScore(nowS, beforeS);
    lines.push(
      "",
      "OVERALL TREND (last 30 days vs the 30 days before, as on the Progress screen):",
      `- Improvement score (0-100, 50 = same as before): ${score ?? "not enough data"} (${scoreBand(score).label}).`,
      `- Average best squeeze per game: ${fmt(nowS.avgPeakForce, " psi")} vs ${fmt(beforeS.avgPeakForce, " psi")}.`,
      `- Average squeezes per game: ${fmt(nowS.avgReps, "", 0)} vs ${fmt(beforeS.avgReps, "", 0)}.`,
      `- Average wrist range per game: ${fmt(nowS.avgRotationRange, " degrees", 0)} vs ${fmt(beforeS.avgRotationRange, " degrees", 0)}.`
    );

    const unitOf = (m) => (m.unit === "°" ? " degrees" : m.unit ? ` ${m.unit}` : "");
    const adv = ADVANCED_METRICS.map((m) => {
      const a = averageOf(current, m.key);
      const b = averageOf(before, m.key);
      if (a === null && b === null) return null;
      const better = m.better === "up" ? "higher is better" : m.better === "down" ? "lower is better" : "";
      return `- ${m.label}: ${fmt(a, unitOf(m), m.digits)} recently vs ${fmt(b, unitOf(m), m.digits)} before${
        better ? ` (${better})` : ""
      }. Meaning: ${m.explain ?? ""}`;
    }).filter(Boolean);
    if (adv.length) lines.push("", "DETAILED MEASUREMENTS (recent 30 days vs before):", ...adv);

    // ---- Per game ----
    lines.push("", "PER GAME (all time):");
    for (const g of GAMES.filter((x) => x.playable)) {
      const mine = sessions.filter((s) => s.game === g.id);
      if (!mine.length) {
        lines.push(`- ${g.name}: never played.`);
        continue;
      }
      const recent = mine.filter((s) => now - s.timestamp < 30 * DAY_MS);
      lines.push(
        `- ${g.name}: played ${mine.length} times, last on ${dayKey(mine[mine.length - 1].timestamp)}; ${recent.length} times in the last 30 days.` +
          (averageOf(mine, "peakForcePsi") !== null ? ` Average best squeeze ${fmt(averageOf(mine, "peakForcePsi"), " psi")}.` : "") +
          (averageOf(mine, "rotationRangeDeg") !== null ? ` Average wrist range ${fmt(averageOf(mine, "rotationRangeDeg"), " degrees", 0)}.` : "")
      );
    }
    // Pre-counted totals (models miscount long lists)
    const tally = (list) => {
      const c = {};
      for (const s of list) c[gameName(s.game)] = (c[gameName(s.game)] ?? 0) + 1;
      const parts = Object.entries(c).sort((a, b) => b[1] - a[1]);
      return parts.length ? parts.map(([g, n]) => `${g} ${n}`).join(", ") : "none";
    };
    const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
    lines.push(
      "",
      "GAMES PLAYED PER PERIOD (already counted -- use these numbers, don't recount):",
      `- This calendar month (since ${dayKey(monthStart)}): ${tally(sessions.filter((s) => s.timestamp >= monthStart))}.`,
      `- Last 7 days: ${tally(sessions.filter((s) => now - s.timestamp < 7 * DAY_MS))}.`,
      `- Last 30 days: ${tally(sessions.filter((s) => now - s.timestamp < 30 * DAY_MS))}.`,
      `- All time: ${tally(sessions)}.`
    );
    const unknown = sessions.filter((s) => !GAMES.some((g) => g.id === s.game)).length;
    if (unknown) lines.push(`- ${unknown} older games were saved without a game name.`);

    // ---- Full recent history ----
    const recent = sessions.filter((s) => now - s.timestamp < HISTORY_DAYS * DAY_MS);
    lines.push("", `GAME HISTORY (every game in the last ${HISTORY_DAYS} days, newest first):`);
    for (const s of [...recent].reverse()) {
      const detail = describeSession(s);
      lines.push(`- ${dayKey(s.timestamp)} (${weekday(s.timestamp)}): ${gameName(s.game)}${detail ? ` -- ${detail}` : ""}`);
    }
    // Older games, a month at a time
    const older = sessions.filter((s) => now - s.timestamp >= HISTORY_DAYS * DAY_MS);
    if (older.length) {
      const months = {};
      for (const s of older) {
        const m = dayKey(s.timestamp).slice(0, 7);
        (months[m] ??= []).push(s);
      }
      lines.push("", "EARLIER HISTORY (by month):");
      for (const [m, list] of Object.entries(months)) {
        lines.push(
          `- ${m}: ${list.length} games; average best squeeze ${fmt(averageOf(list, "peakForcePsi"), " psi")}; average wrist range ${fmt(
            averageOf(list, "rotationRangeDeg"),
            " degrees",
            0
          )}.`
        );
      }
    }
  }

  lines.push("");
  if (baseline) {
    lines.push(
      `STARTING-POINT CHECK (baseline, taken ${dayKey(baseline.at)}): comfortable squeeze ${round(baseline.maxPsi - baseline.restPsi)} psi; ` +
        `wrist tilt up/down ${baseline.pitchUp}/${baseline.pitchDown} degrees; turn right/left ${baseline.rollRight}/${baseline.rollLeft} degrees` +
        (Number.isFinite(baseline.yawRight) ? `; side to side right/left ${baseline.yawRight}/${baseline.yawLeft} degrees.` : ".")
    );
  } else {
    lines.push("STARTING-POINT CHECK: not taken yet.");
  }
  return lines.join("\n");
}
