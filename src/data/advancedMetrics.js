// The measurements shown in Progress -> Advanced details. Each game records
// what it can measure (see src/games/metrics.js); sessions without a value
// are simply left out of that measurement's average.
//
// better: which direction is an improvement ("up", "down", or null = neither)
// delta:  how change is shown: "percent" (relative) or "points" (difference)
export const ADVANCED_METRICS = [
  {
    key: "holdBestS",
    group: "grip",
    label: "Hold endurance",
    unit: "s",
    digits: 1,
    better: "up",
    delta: "percent",
    explain:
      "The longest time you kept your squeeze at or above half of your comfortable max. Longer means more grip endurance.",
  },
  {
    key: "gripWobblePct",
    group: "grip",
    label: "Grip steadiness",
    unit: "%",
    prefix: "±",
    digits: 1,
    better: "down",
    delta: "points",
    explain:
      "How much your squeeze wobbles while you hold it, as a share of your comfortable max. Smaller is steadier.",
  },
  {
    key: "releaseSmoothness",
    group: "grip",
    label: "Release control",
    unit: "/100",
    digits: 0,
    better: "up",
    delta: "points",
    explain:
      "How smoothly you let go. 100 means one even, steady release. Lower means squeezing back up partway through.",
  },
  {
    key: "releaseTimeS",
    group: "grip",
    label: "Release time",
    unit: "s",
    digits: 2,
    better: "down",
    delta: "percent",
    explain:
      "Seconds from starting to let go until your hand is relaxed. Relaxing quickly usually means less stiffness.",
  },
  {
    key: "timeToTargetS",
    group: "grip",
    label: "Squeeze-up time",
    unit: "s",
    digits: 2,
    better: "down",
    delta: "percent",
    explain: "How quickly you reach each bubble's target once you start squeezing.",
  },
  {
    key: "fatiguePct",
    group: "grip",
    label: "Fatigue",
    unit: "%",
    signed: true,
    digits: 0,
    better: "up",
    delta: "points",
    explain:
      "How much your squeezes change from the start of a round to the end. Near 0 means your strength held up. A big minus means your hand tired.",
  },
  {
    key: "tremorDeg",
    group: "wrist",
    label: "Wrist steadiness",
    unit: "°",
    digits: 2,
    better: "down",
    delta: "percent",
    explain:
      "The size of small, quick shakes in your wrist, measured by the motion sensor. It only counts shakes of about 2.5 to 12 per second, where hand tremors happen, not normal movement. Smaller is steadier.",
  },
  {
    key: "tremorHz",
    group: "wrist",
    label: "Shake rhythm",
    unit: "/s",
    digits: 1,
    better: null,
    explain:
      "How many shakes per second, shown when there's enough shaking to time. Hand tremors are often 4 to 12 per second, and the rhythm can help a therapist tell different kinds apart.",
  },
  {
    key: "pitchRangeDeg",
    group: "wrist",
    label: "Tilt range",
    unit: "°",
    digits: 0,
    better: "up",
    delta: "percent",
    explain: "How far you tilted your hand up and down during Tilt Maze.",
  },
  {
    key: "rollRangeDeg",
    group: "wrist",
    label: "Palm-turn range",
    unit: "°",
    digits: 0,
    better: "up",
    delta: "percent",
    explain: "How far you turned your palm during Tilt Maze.",
  },
];

export const METRIC_GROUPS = [
  { id: "grip", label: "Grip control" },
  { id: "wrist", label: "Wrist" },
];

export function formatMetric(metric, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const n = Number(value.toFixed(metric.digits));
  const sign = metric.signed && n > 0 ? "+" : "";
  return `${metric.prefix ?? ""}${sign}${n.toFixed(metric.digits)}`;
}

// Plain-language label for the tremor amount, so the number has meaning.
export function tremorWords(deg) {
  if (deg === null || !Number.isFinite(deg)) return null;
  if (deg < 0.3) return "Very steady";
  if (deg < 1) return "Slight shake";
  if (deg < 2.5) return "Noticeable shake";
  return "Strong shake";
}

// Every saved session as a CSV a therapist can open in a spreadsheet.
// Column names say what each value is and its unit.
const CSV_NAMES = {
  holdBestS: "hold_endurance_s",
  gripWobblePct: "grip_wobble_pct_of_max",
  releaseSmoothness: "release_control_0_to_100",
  releaseTimeS: "release_time_s",
  timeToTargetS: "squeeze_up_time_s",
  fatiguePct: "fatigue_pct_points",
  tremorDeg: "wrist_tremor_deg_rms",
  tremorHz: "tremor_rhythm_per_s",
  pitchRangeDeg: "tilt_range_deg",
  rollRangeDeg: "palm_turn_range_deg",
};

const CSV_COLUMNS = [
  ["date", (s) => new Date(s.timestamp).toISOString()],
  ["game", (s) => s.game ?? ""],
  ["session_id", (s) => s.groupId ?? ""],
  ["duration_s", (s) => s.durationS],
  ["peak_squeeze_psi", (s) => s.peakForcePsi],
  ["avg_squeeze_psi", (s) => s.avgForcePsi],
  ["squeezes", (s) => s.reps],
  ["wrist_range_deg", (s) => s.rotationRangeDeg],
  ...ADVANCED_METRICS.map((m) => [CSV_NAMES[m.key] ?? m.key, (s) => s[m.key]]),
];

export function sessionsToCsv(sessions) {
  const cell = (v) => (v === null || v === undefined ? "" : String(v).replace(/[",\n]/g, " "));
  const rows = sessions.map((s) => CSV_COLUMNS.map(([, get]) => cell(get(s))).join(","));
  return [CSV_COLUMNS.map(([name]) => name).join(","), ...rows].join("\n");
}
