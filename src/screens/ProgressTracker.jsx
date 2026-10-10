import { useMemo, useState } from "react";
import {
  CalendarCheck,
  ChevronDown,
  Gamepad2,
  Hand,
  Info,
  Microscope,
  Repeat,
  RotateCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  RANGE_OPTIONS,
  baselineForRange,
  sessionsInRange,
  improvementScore,
  percentChange,
  summarize,
} from "../data/scoring";
import { comparisonLabel, friendlyDate, scoreBand } from "../data/insights";
import LineChart from "../components/LineChart";
import ScoreRing from "../components/ScoreRing";
import StatTile from "../components/StatTile";
import DemoBanner from "../components/DemoBanner";
import { GAMES } from "../data/games";
import AdvancedDetails from "../components/AdvancedDetails";

const ADVANCED_KEY = "aquagrip.advancedOpen";
function loadAdvancedOpen() {
  try {
    return localStorage.getItem(ADVANCED_KEY) === "1";
  } catch {
    return false;
  }
}

function SessionRow({ session: s }) {
  const game = GAMES.find((g) => g.id === s.game);
  const minutes = Math.round(s.durationS / 60) || 1;
  const isGrip = Number.isFinite(s.peakForcePsi);
  const Icon = game?.icon ?? Hand;

  return (
    <div className={`list-row tint-${game?.tint ?? "sky"}`}>
      <div className="list-icon">
        <Icon size={20} aria-hidden="true" />
      </div>
      <div className="list-main">
        <div className="list-title">{friendlyDate(s.timestamp)}</div>
        <div className="list-sub">
          {game ? game.name : `${s.reps} squeezes`} · {minutes} min
        </div>
      </div>
      <div className="list-value">
        {isGrip ? s.peakForcePsi.toFixed(1) : `${Math.round(s.rotationRangeDeg)}°`}
        <small>{isGrip ? "best psi" : "wrist range"}</small>
      </div>
    </div>
  );
}

function EmptyProgress({ onNavigate }) {
  return (
    <section className="card empty tint-lavender">
      <div className="empty-icon">
        <TrendingUp size={30} aria-hidden="true" />
      </div>
      <h2>No sessions yet</h2>
      <p>Play a game and your progress will show up here: your score, charts, and streaks.</p>
      <button className="btn btn-primary" onClick={() => onNavigate("games")}>
        <Gamepad2 size={18} aria-hidden="true" style={{ verticalAlign: "-3px", marginRight: 8 }} />
        Go to games
      </button>
    </section>
  );
}

export default function ProgressTracker({ sessions, demoMode, onNavigate }) {
  const [rangeId, setRangeId] = useState("30d");
  const range = RANGE_OPTIONS.find((r) => r.id === rangeId);

  const data = useMemo(() => {
    // Everything in the range is shown; the score and % changes compare the
    // range with the one before it (or its own halves when history is short).
    const inRange = sessionsInRange(sessions, range.days);
    const { current, baseline } = baselineForRange(sessions, range.days);
    const now = summarize(current);
    const before = summarize(baseline);
    return {
      inRange,
      currentList: current,
      baselineList: baseline,
      shown: summarize(inRange),
      now,
      before,
      score: improvementScore(now, before),
    };
  }, [sessions, range.days]);
  const [showAdvanced, setShowAdvanced] = useState(loadAdvancedOpen);
  const toggleAdvanced = () => {
    setShowAdvanced((open) => {
      try {
        localStorage.setItem(ADVANCED_KEY, open ? "0" : "1");
      } catch {
        // Not remembered next visit; that's fine.
      }
      return !open;
    });
  };

  const band = scoreBand(data.score);
  const compare = comparisonLabel(range);
  const recent = data.inRange.slice(-4).reverse();
  const { avgPeakForce: grip, avgReps: reps, avgRotationRange: wrist } = data.shown;
  const gripPoints = data.inRange
    .filter((s) => Number.isFinite(s.avgForcePsi))
    .map((s) => ({ id: s.id, timestamp: s.timestamp, value: s.avgForcePsi }));

  const header = (
    <>
      {demoMode && <DemoBanner onNavigate={onNavigate} />}
      <header className="screen-header">
        <div className="eyebrow">Progress</div>
        <h1 className="title">How you're doing</h1>
      </header>
    </>
  );

  if (sessions.length === 0) {
    return (
      <>
        {header}
        <EmptyProgress onNavigate={onNavigate} />
      </>
    );
  }

  return (
    <>
      {header}

      <div className="segmented" role="group" aria-label="Time range">
        {RANGE_OPTIONS.map((opt) => (
          <button key={opt.id} aria-pressed={opt.id === rangeId} onClick={() => setRangeId(opt.id)}>
            {opt.label}
          </button>
        ))}
      </div>

      <section className="card" style={{ marginTop: 16 }} aria-label="Improvement score">
        <div className="score-row">
          <ScoreRing value={data.score ?? 0}>
            <div className="ring-value">{data.score ?? "–"}</div>
            <div className="ring-sub">out of 100</div>
          </ScoreRing>
          <div className="score-text">
            <span className={`pill pill--${band.tone}`}>
              <Sparkles size={15} aria-hidden="true" /> {band.label}
            </span>
            <p className="score-message">{band.message}</p>
          </div>
        </div>
        <details className="explain">
          <summary>
            <Info size={16} aria-hidden="true" /> How is this score worked out?
          </summary>
          <p>
            We compare this period with the one before it. A stronger grip, more squeezes, and a wider wrist turn
            all raise your score. A score of 50 means about the same as before.
          </p>
        </details>
      </section>

      <h2 className="section-title">Grip strength over time</h2>
      <section className="card">
        <p className="card-sub">Your average squeeze in each session</p>
        {gripPoints.length === 0 && data.inRange.length > 0 ? (
          <p className="card-sub">No grip games in this time range yet.</p>
        ) : (
          <LineChart points={gripPoints} valueLabel="Average squeeze" unit="psi" />
        )}
      </section>

      <h2 className="section-title">
        At a glance
        <span className="section-note">{compare}</span>
      </h2>
      <div className="stats">
        <StatTile
          icon={Hand}
          tint="sky"
          label="Grip strength"
          value={grip === null ? "—" : grip.toFixed(1)}
          unit={grip === null ? undefined : "psi"}
          delta={percentChange(data.now.avgPeakForce, data.before.avgPeakForce)}
        />
        <StatTile
          icon={Repeat}
          tint="mint"
          label="Squeezes per session"
          value={reps === null ? "—" : Math.round(reps)}
          delta={percentChange(data.now.avgReps, data.before.avgReps)}
        />
        <StatTile
          icon={RotateCw}
          tint="lavender"
          label="Wrist motion"
          value={wrist === null ? "—" : Math.round(wrist)}
          unit={wrist === null ? undefined : "°"}
          delta={percentChange(data.now.avgRotationRange, data.before.avgRotationRange)}
        />
        <StatTile icon={CalendarCheck} tint="peach" label="Sessions" value={data.shown.count} />
      </div>

      <button className="adv-toggle" onClick={toggleAdvanced} aria-expanded={showAdvanced}>
        <Microscope size={18} aria-hidden="true" />
        {showAdvanced ? "Hide advanced details" : "Show advanced details"}
        <ChevronDown size={18} aria-hidden="true" className={`adv-chevron${showAdvanced ? " is-open" : ""}`} />
      </button>
      {showAdvanced && (
        <AdvancedDetails
          inRange={data.inRange}
          now={data.currentList}
          before={data.baselineList}
          compare={compare}
          allSessions={sessions}
          demoMode={demoMode}
        />
      )}

      {recent.length > 0 && (
        <>
          <h2 className="section-title">Recent sessions</h2>
          <section className="card" style={{ paddingBlock: 8 }}>
            {recent.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </section>
        </>
      )}
    </>
  );
}
