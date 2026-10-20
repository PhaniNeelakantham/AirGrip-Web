import { useMemo, useState } from "react";
import { ArrowUpRight, Gamepad2, Hand, RotateCw, Settings, TrendingUp } from "lucide-react";
import { baselineForRange, improvementScore, percentChange, summarize } from "../data/scoring";
import { WEEKLY_GOAL, currentStreak, greeting, scoreBand, statusText, weekOverview } from "../data/insights";
import { GAMES } from "../data/games";
import DemoBanner from "../components/DemoBanner";
import InstallCard from "../components/InstallCard";
import ScoreRing from "../components/ScoreRing";
import StatTile from "../components/StatTile";
import WeekStreak from "../components/WeekStreak";
import TodayCard from "../session/TodayCard";
import BaselineCard from "../baseline/BaselineCard";
import { useBaseline } from "../data/baseline";
import SettingsSheet from "../components/SettingsSheet";
import GuestBanner from "../components/GuestBanner";
import { useGuest } from "../data/guest";
import { setDevMode, useDevMode } from "../data/devMode";
import { Wrench } from "lucide-react";

export default function Home({ sessions, onNavigate, onStartSession, onOpenBaseline, connectionState, demoMode }) {
  const baseline = useBaseline(demoMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const guest = useGuest() && !demoMode;
  const devMode = useDevMode() && !demoMode;
  const data = useMemo(() => {
    const { days, sessionsThisWeek } = weekOverview(sessions);
    const { current, baseline } = baselineForRange(sessions, 30);
    const now = summarize(current);
    const before = summarize(baseline);
    return {
      days,
      sessionsThisWeek,
      streak: currentStreak(sessions),
      now,
      before,
      score: improvementScore(now, before),
    };
  }, [sessions]);

  const grip = data.now.avgPeakForce;
  const wrist = data.now.avgRotationRange;

  const remaining = Math.max(0, WEEKLY_GOAL - data.sessionsThisWeek);
  const band = scoreBand(data.score);
  const connected = connectionState === "connected";

  return (
    <>
      <div className="topbar">
        <div className="topbar-actions">
          <button className="status-chip" onClick={() => onNavigate("games")}>
            <span className={`status-dot${connected ? " is-on" : ""}`} aria-hidden="true" />
            {statusText(connectionState, demoMode)}
          </button>
          <button className="icon-btn topbar-gear" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <Settings size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      {settingsOpen && (
        <SettingsSheet demoMode={demoMode} onClose={() => setSettingsOpen(false)} onOpenBaseline={onOpenBaseline} />
      )}

      <InstallCard />
      {demoMode && <DemoBanner onNavigate={onNavigate} />}
      {guest && <GuestBanner onOpenBaseline={onOpenBaseline} />}
      {devMode && (
        <div className="banner tint-butter" role="status">
          <Wrench size={18} aria-hidden="true" />
          <span>
            <strong>Developer mode</strong>
            <button className="link-btn" onClick={() => setDevMode(false)}>
              Turn off
            </button>
          </span>
        </div>
      )}

      <header className="screen-header">
        <div className="eyebrow">{greeting()}</div>
        <h1 className="title">{guest ? "Welcome!" : "Welcome back"}</h1>
      </header>

      {/* No baseline yet: lead with it. Done: a small summary under today's session. */}
      {!baseline && <BaselineCard demoMode={demoMode} onStart={onOpenBaseline} />}
      <TodayCard demoMode={demoMode} onStart={onStartSession} />
      {baseline && <BaselineCard demoMode={demoMode} onStart={onOpenBaseline} />}

      <section className="hero" aria-label="This week">
        <div className="hero-text">
          <div className="hero-label">This week</div>
          <div className="hero-value">
            {data.sessionsThisWeek} of {WEEKLY_GOAL} sessions
          </div>
          <p className="hero-note">
            {remaining === 0
              ? "Weekly goal reached. Nice work!"
              : `${remaining} more to reach your weekly goal.`}
          </p>
        </div>
        <ScoreRing
          value={Math.min(data.sessionsThisWeek, WEEKLY_GOAL)}
          max={WEEKLY_GOAL}
          size={96}
          stroke={10}
          color="var(--teal-bright)"
          trackColor="rgba(255,255,255,0.18)"
        >
          <div className="ring-value" style={{ fontSize: 26 }}>
            {Math.round((Math.min(data.sessionsThisWeek, WEEKLY_GOAL) / WEEKLY_GOAL) * 100)}%
          </div>
        </ScoreRing>
      </section>

      <div className="tiles">
        <button className="tile tile--games" onClick={() => onNavigate("games")}>
          <div className="tile-top">
            <span className="tile-icon">
              <Gamepad2 size={24} aria-hidden="true" />
            </span>
            <ArrowUpRight size={22} aria-hidden="true" />
          </div>
          <div>
            <div className="tile-title">Play games</div>
            <div className="tile-sub">{GAMES.length} fun exercises</div>
          </div>
        </button>
        <button className="tile tile--progress" onClick={() => onNavigate("progress")}>
          <div className="tile-top">
            <span className="tile-icon">
              <TrendingUp size={24} aria-hidden="true" />
            </span>
            <ArrowUpRight size={22} aria-hidden="true" />
          </div>
          <div>
            <div className="tile-title">My progress</div>
            <div className="tile-sub">
              {data.score === null ? "See your trends" : band.label}
            </div>
          </div>
        </button>
      </div>

      <h2 className="section-title">Your week</h2>
      <WeekStreak days={data.days} streak={data.streak} />

      <h2 className="section-title">
        This month
        <span className="section-note">vs previous 30 days</span>
      </h2>
      <div className="stats">
        <StatTile
          icon={Hand}
          tint="sky"
          label="Grip strength"
          value={grip === null ? "—" : grip.toFixed(1)}
          unit={grip === null ? undefined : "psi"}
          delta={percentChange(grip, data.before.avgPeakForce)}
        />
        <StatTile
          icon={RotateCw}
          tint="lavender"
          label="Wrist motion"
          value={wrist === null ? "—" : Math.round(wrist)}
          unit={wrist === null ? undefined : "°"}
          delta={percentChange(wrist, data.before.avgRotationRange)}
        />
      </div>
    </>
  );
}
