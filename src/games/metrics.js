// Advanced measurements recorded during games, for the Progress screen's
// "Advanced details". Grip values use the game's "level" (0 = relaxed,
// 1 = comfortable max from the grip check); wrist values use degrees.
// These describe trends for the player and their therapist; they are not
// a medical diagnosis.

const round = (v, digits) => (v === null || !Number.isFinite(v) ? null : Number(v.toFixed(digits)));

// ---------- grip: hold endurance, steadiness, release control ----------
const HOLD_LEVEL = 0.5; // "holding" = at least half of the comfortable max
const RELEASE_FROM = 0.25; // a squeeze must reach this before its release counts
const RELEASE_TO = 0.15; // released = back down to this
const RELEASE_START_DROP = 0.85; // release starts once level falls below 85% of the squeeze's peak
const UPTICK = 0.01; // a rise bigger than this during a release = squeezing back up
const HOLD_SETTLE_S = 0.4; // ignore the start of a hold (still ramping up)
const HOLD_TRIM_END_S = 0.3; // ...and its end (starting to let go)

export function createGripTracker() {
  let holdRun = 0;
  let holdBest = 0;
  let holdTime = 0;
  let segment = []; // { t, level } for the current hold
  let segmentT = 0;
  let wobbleSumSq = 0; // squared leftovers, weighted by time
  let wobbleTime = 0;

  // Wobble of one finished hold: trim the ramp-up and let-go, remove any slow
  // drift with a straight-line fit, and keep only the shakiness left over.
  const finishSegment = () => {
    const end = segmentT - HOLD_TRIM_END_S;
    const pts = segment.filter((p) => p.t > HOLD_SETTLE_S && p.t < end);
    segment = [];
    segmentT = 0;
    if (pts.length < 10) return;
    const n = pts.length;
    const mt = pts.reduce((a, p) => a + p.t, 0) / n;
    const ml = pts.reduce((a, p) => a + p.level, 0) / n;
    let cov = 0;
    let vt = 0;
    for (const p of pts) {
      cov += (p.t - mt) * (p.level - ml);
      vt += (p.t - mt) ** 2;
    }
    const slope = vt ? cov / vt : 0;
    const span = pts[n - 1].t - pts[0].t;
    const sq = pts.reduce((a, p) => a + (p.level - (ml + slope * (p.t - mt))) ** 2, 0) / n;
    wobbleSumSq += sq * span;
    wobbleTime += span;
  };

  let peak = 0; // peak of the current squeeze
  let release = null; // { elapsed, frames, ups, prev } while letting go
  const releases = []; // { timeS, smooth }

  return {
    update(level, dt) {
      // Hold endurance + steadiness while holding.
      if (level >= HOLD_LEVEL) {
        holdRun += dt;
        holdTime += dt;
        holdBest = Math.max(holdBest, holdRun);
        segmentT += dt;
        segment.push({ t: segmentT, level });
      } else {
        if (segment.length) finishSegment();
        holdRun = 0;
      }

      // Release control.
      if (release) {
        release.elapsed += dt;
        release.frames++;
        if (level > release.prev + UPTICK) release.ups++;
        release.prev = level;
        if (level > peak) {
          release = null; // squeezed harder again: not a release after all
        } else if (level <= RELEASE_TO) {
          releases.push({ timeS: release.elapsed, smooth: 1 - release.ups / Math.max(1, release.frames) });
          release = null;
          peak = 0;
        }
        return;
      }
      if (level > peak) peak = level;
      if (peak >= RELEASE_FROM && level < peak * RELEASE_START_DROP) {
        release = { elapsed: 0, frames: 0, ups: 0, prev: level };
      }
      if (level <= RELEASE_TO) peak = 0;
    },

    result() {
      if (segment.length) finishSegment();
      const wobble = wobbleTime > 0 ? Math.sqrt(wobbleSumSq / wobbleTime) : 0;
      const avg = (key) => (releases.length ? releases.reduce((s, r) => s + r[key], 0) / releases.length : null);
      return {
        holdBestS: round(holdBest, 1),
        // Only meaningful with at least a second of holding.
        gripWobblePct: wobbleTime >= 1 ? round(wobble * 100, 1) : null,
        releaseTimeS: round(avg("timeS"), 2),
        releaseSmoothness: releases.length ? Math.round(avg("smooth") * 100) : null,
      };
    },
  };
}

// ---------- wrist: tremor amount and rhythm ----------
// Keep only quick shakes (about 2.5-12 per second, where hand tremors occur)
// with a 4th-order high-pass at 2.5 Hz and a 2nd-order low-pass at 12 Hz,
// so slow, intentional wrist movement is almost completely removed.
// The filters assume the device's 50 readings/second; at much slower rates
// (e.g. the Bluetooth fallback) a 5-12 Hz tremor can't be measured, so
// nothing is reported.
const FS = 50;
const ZERO_HYSTERESIS = 0.1; // degrees; ignore sign flips smaller than this (noise)
const MIN_SAMPLES = 150; // ~3 s of data
const SETTLE_SAMPLES = 25; // let the filters settle before counting
const RHYTHM_MIN_DEG = 0.3; // below this there's too little shake to time its rhythm

// RBJ audio-cookbook biquad coefficients.
function biquad(type, f0, q) {
  const w = (2 * Math.PI * f0) / FS;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const b1 = type === "high" ? -(1 + cos) : 1 - cos;
  const b0 = type === "high" ? (1 + cos) / 2 : (1 - cos) / 2;
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function runBiquad(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}

function axisBand() {
  // Two high-pass stages (Butterworth 4th order) + one low-pass stage.
  return {
    stages: [biquad("high", 2.5, 0.5412), biquad("high", 2.5, 1.3066), biquad("low", 12, 0.7071)],
    primed: false,
    sumSq: 0,
    sign: 0,
    crossings: 0,
  };
}

function stepAxis(a, value, counting) {
  if (!a.primed) {
    // Start the filters at the current angle so the first sample isn't a big jump.
    for (const st of a.stages) st.x1 = st.x2 = 0;
    a.offset = value;
    a.primed = true;
  }
  let v = value - a.offset;
  for (const st of a.stages) v = runBiquad(st, v);
  if (!counting) return;
  a.sumSq += v * v;
  const sign = v > ZERO_HYSTERESIS ? 1 : v < -ZERO_HYSTERESIS ? -1 : a.sign;
  if (a.sign !== 0 && sign !== a.sign) a.crossings++;
  a.sign = sign;
}

// Feed it real sensor samples (not screen frames), with the seconds since
// the previous sample.
export function createTremorTracker() {
  let pitch = axisBand();
  let roll = axisBand();
  let seen = 0; // samples since the filters (re)started
  let samples = 0;
  let duration = 0;

  return {
    add(angles, dt) {
      if (!(dt > 0) || dt > 0.25) {
        // A gap in the data: restart the filters rather than see a jump as a shake.
        const keep = (old) => ({ ...axisBand(), sumSq: old.sumSq, crossings: old.crossings });
        pitch = keep(pitch);
        roll = keep(roll);
        seen = 0;
        return;
      }
      seen++;
      const counting = seen > SETTLE_SAMPLES;
      stepAxis(pitch, angles.pitch, counting);
      stepAxis(roll, angles.roll, counting);
      if (counting) {
        samples++;
        duration += dt;
      }
    },

    result() {
      const rate = duration > 0 ? samples / duration : 0;
      if (samples < MIN_SAMPLES || rate < 40 || rate > 65) return { tremorDeg: null, tremorHz: null };
      const rms = Math.sqrt((pitch.sumSq + roll.sumSq) / samples);
      const main = pitch.sumSq >= roll.sumSq ? pitch : roll;
      return {
        tremorDeg: round(rms, 2),
        tremorHz: rms >= RHYTHM_MIN_DEG ? round(main.crossings / 2 / duration, 1) : null,
      };
    },
  };
}

// Change in squeeze strength from the start of a round to the end, in
// percentage points of the comfortable max (negative = weaker by the end).
export function fatiguePct(popPeaks) {
  if (popPeaks.length < 6) return null;
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return round((avg(popPeaks.slice(-3)) - avg(popPeaks.slice(0, 3))) * 100, 1);
}
