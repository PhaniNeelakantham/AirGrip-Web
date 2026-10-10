// Fake session history for building/testing the Progress Tracker before
// real usage data exists. Trends gently upward with noise so period
// comparisons and the improvement score have something real to show.
// Replace with actual logged sessions once games are wired up.
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 140;

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function generateMockSessions() {
  const rand = seededRandom(42);
  const rand2 = seededRandom(1337);
  const sessions = [];
  const now = Date.now();
  let id = 0;

  for (let dayIndex = HISTORY_DAYS; dayIndex >= 0; dayIndex--) {
    const dayStart = now - dayIndex * DAY_MS;
    const skip = rand() < 0.35; // not every day has a session
    if (skip) continue;

    const sessionsToday = rand() < 0.15 ? 2 : 1;
    // progress ramps from 0 (oldest) to 1 (most recent)
    const progress = 1 - dayIndex / HISTORY_DAYS;

    for (let s = 0; s < sessionsToday; s++) {
      const noise = () => (rand() - 0.5) * 2;

      const peakForcePsi = Math.max(0.5, 5 + progress * 3 + noise() * 1.2);
      const avgForcePsi = Math.max(0.3, peakForcePsi * (0.55 + noise() * 0.08));
      const reps = Math.max(1, Math.round(8 + progress * 6 + noise() * 3));
      const rotationRangeDeg = Math.max(10, 45 + progress * 25 + noise() * 10);
      const durationS = Math.max(20, 60 + progress * 60 + noise() * 15);

      // Advanced measurements, from their own random stream so the basic
      // sample numbers above stay exactly as they were.
      const n2 = () => (rand2() - 0.5) * 2;
      sessions.push({
        id: id++,
        timestamp: dayStart - s * 3600_000 - Math.floor(rand() * 3600_000),
        durationS,
        peakForcePsi,
        avgForcePsi,
        reps,
        rotationRangeDeg,
        holdBestS: Number(Math.max(0.5, 3.5 + progress * 5 + n2() * 1.2).toFixed(1)),
        gripWobblePct: Number(Math.max(0.5, 6.5 - progress * 3 + n2() * 0.8).toFixed(1)),
        releaseSmoothness: Math.round(Math.min(100, 72 + progress * 16 + n2() * 6)),
        releaseTimeS: Number(Math.max(0.15, 0.85 - progress * 0.35 + n2() * 0.08).toFixed(2)),
        timeToTargetS: Number(Math.max(0.3, 1.4 - progress * 0.5 + n2() * 0.15).toFixed(2)),
        fatiguePct: Math.round(-17 + progress * 9 + n2() * 4),
        tremorDeg: Number(Math.max(0.05, 1.1 - progress * 0.45 + n2() * 0.15).toFixed(2)),
        tremorHz: Number((5.3 + n2() * 0.5).toFixed(1)),
        pitchRangeDeg: Math.round(Math.max(10, 42 + progress * 18 + n2() * 6)),
        rollRangeDeg: Math.round(Math.max(10, 30 + progress * 15 + n2() * 6)),
      });
    }
  }

  return sessions.sort((a, b) => a.timestamp - b.timestamp);
}

export const mockSessions = generateMockSessions();
