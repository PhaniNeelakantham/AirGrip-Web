// Turns raw session history into what the Progress Tracker screen shows:
// a filtered slice, its summary stats, and an improvement score.
const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_OPTIONS = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "100d", label: "100 days", days: 100 },
  { id: "all", label: "All time", days: Infinity },
];

export function sessionsInRange(sessions, days, now = Date.now()) {
  if (days === Infinity) return sessions;
  const cutoff = now - days * DAY_MS;
  return sessions.filter((s) => s.timestamp >= cutoff);
}

// The period immediately before the selected one, same length -- the
// baseline an improvement score and deltas are measured against. Falls
// back to splitting the selected range itself in half when there isn't
// enough earlier history (e.g. "All time", or a new user).
export function baselineForRange(sessions, days, now = Date.now()) {
  if (days === Infinity) {
    const current = sessions;
    const mid = Math.floor(current.length / 2);
    return { current: current.slice(mid), baseline: current.slice(0, mid) };
  }

  const cutoff = now - days * DAY_MS;
  const prevCutoff = cutoff - days * DAY_MS;
  const current = sessions.filter((s) => s.timestamp >= cutoff);
  const baseline = sessions.filter(
    (s) => s.timestamp >= prevCutoff && s.timestamp < cutoff
  );

  if (baseline.length >= 2) return { current, baseline };

  // Not enough prior history -- split the current window instead.
  const mid = Math.floor(current.length / 2);
  return { current: current.slice(mid), baseline: current.slice(0, mid) };
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Averages only the sessions that recorded this metric (a wrist-only game
// has no grip numbers); null when none did.
export function averageOf(sessions, key) {
  const values = sessions.map((s) => s[key]).filter(Number.isFinite);
  return values.length ? average(values) : null;
}

// Games played inside one guided session share a groupId and count as one
// session; games played on their own each count as one.
export function countSessions(records) {
  return new Set(records.map((s) => s.groupId ?? `single-${s.id}`)).size;
}

export function summarize(sessions) {
  return {
    count: countSessions(sessions),
    avgPeakForce: averageOf(sessions, "peakForcePsi"),
    avgReps: averageOf(sessions, "reps"),
    avgRotationRange: averageOf(sessions, "rotationRangeDeg"),
  };
}

export function percentChange(current, baseline) {
  if (current === null || baseline === null) return null;
  if (baseline === 0) return current === 0 ? 0 : 100;
  return ((current - baseline) / baseline) * 100;
}

// Maps a %-change onto a 0-100 metric score: 0% change -> 50 (no change),
// +/-50% or more change is fully saturated to 100 / 0. Clamped in between,
// so one wild outlier session can't swing the score off the scale.
function metricScore(current, baseline) {
  const change = percentChange(current, baseline);
  const clamped = Math.max(-50, Math.min(50, change));
  return 50 + clamped;
}

// The "improvement score out of 100": average of the metric scores (peak
// force, reps, rotation range) that both periods have data for, comparing
// the selected period against the one immediately before it.
// 50 = no change, 100 = each metric up 50%+, 0 = each down 50%+.
export function improvementScore(currentSummary, baselineSummary) {
  const scores = ["avgPeakForce", "avgReps", "avgRotationRange"]
    .filter((k) => currentSummary[k] !== null && baselineSummary[k] !== null)
    .map((k) => metricScore(currentSummary[k], baselineSummary[k]));
  return scores.length ? Math.round(average(scores)) : null;
}
