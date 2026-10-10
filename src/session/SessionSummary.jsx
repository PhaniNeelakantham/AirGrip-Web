import { Flame, House, PartyPopper, Timer, TrendingUp } from "lucide-react";
import { GAMES } from "../data/games";
import { WEEKLY_GOAL, currentStreak, weekOverview } from "../data/insights";

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// One plain-language line per exercise.
function describe(gameId, r) {
  if (!r) return "Skipped";
  switch (gameId) {
    case "squeeze-pop":
      return `${r.popped}/15 bubbles popped · best squeeze ${r.peak.toFixed(1)} psi`;
    case "tilt-maze":
      return `Finished in ${mmss(r.timeS)} · ${r.rangeDeg}° of wrist motion`;
    case "balloon-rescue":
      return r.outcome === "deflated"
        ? `The balloon didn't fill this time (${r.pumps} pumps)`
        : `${r.pumps} pumps · ${r.dodged} asteroids dodged`;
    default:
      return "Done";
  }
}

export default function SessionSummary({ results, durationMs, sessions, demoMode, onHome, onProgress }) {
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  const { sessionsThisWeek } = weekOverview(sessions);
  const streak = currentStreak(sessions);
  const goalLeft = Math.max(0, WEEKLY_GOAL - sessionsThisWeek);

  return (
    <>
      <section className="summary-hero">
        <div className="summary-icon">
          <PartyPopper size={38} aria-hidden="true" />
        </div>
        <h1 className="title">Session complete!</h1>
      </section>

      <div className="stats summary-stats">
        <div className="stat tint-sky">
          <div className="stat-icon">
            <Timer size={20} aria-hidden="true" />
          </div>
          <div className="stat-label">Time</div>
          <div className="stat-value">
            {minutes}
            <span className="stat-unit">min</span>
          </div>
        </div>
        <div className="stat tint-peach">
          <div className="stat-icon">
            <Flame size={20} aria-hidden="true" />
          </div>
          <div className="stat-label">Streak</div>
          <div className="stat-value">
            {streak}
            <span className="stat-unit">{streak === 1 ? "day" : "days"}</span>
          </div>
        </div>
      </div>

      <h2 className="section-title">What you did</h2>
      <section className="card" style={{ paddingBlock: 8 }}>
        {results.map(({ gameId, result }) => {
          const game = GAMES.find((g) => g.id === gameId);
          const Icon = game.icon;
          return (
            <div key={gameId} className={`list-row tint-${game.tint}`}>
              <div className="list-icon">
                <Icon size={20} aria-hidden="true" />
              </div>
              <div className="list-main">
                <div className="list-title">{game.name}</div>
                <div className="list-sub">{describe(gameId, result)}</div>
              </div>
            </div>
          );
        })}
      </section>

      <p className="plan-note summary-goal">
        {goalLeft === 0
          ? `Weekly goal reached: ${sessionsThisWeek} of ${WEEKLY_GOAL} sessions this week!`
          : `${sessionsThisWeek} of ${WEEKLY_GOAL} sessions this week. ${goalLeft} more to reach your goal.`}
        {demoMode && " (Demo: this session wasn't saved.)"}
      </p>

      <button className="btn btn-primary btn-block btn-big" onClick={onHome}>
        <House size={20} aria-hidden="true" /> Back to home
      </button>
      <button className="btn btn-secondary btn-block" onClick={onProgress}>
        <TrendingUp size={18} aria-hidden="true" /> See my progress
      </button>
    </>
  );
}
