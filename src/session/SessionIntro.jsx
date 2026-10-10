import { Bluetooth, Clock, Play, Sparkles, X } from "lucide-react";
import { PLAN_MINUTES, TODAY_PLAN } from "./plan";

export default function SessionIntro({ demoMode, connectionState, onStart, onExit }) {
  const connected = connectionState === "connected";

  return (
    <>
      <div className="game-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Back">
          <X size={22} aria-hidden="true" />
        </button>
        <div className="game-bar-title">Today's session</div>
      </div>

      <section className="hero session-hero">
        <div className="hero-text">
          <div className="hero-label">
            <Sparkles size={15} aria-hidden="true" /> Your plan for today
          </div>
          <div className="hero-value">
            {TODAY_PLAN.length} exercises · about {PLAN_MINUTES} min
          </div>
          <p className="hero-note">Short and gentle. Take breaks whenever you need to.</p>
        </div>
      </section>

      <ol className="plan-list">
        {TODAY_PLAN.map(({ gameId, purpose, game }, i) => {
          const Icon = game.icon;
          return (
            <li key={gameId} className={`plan-step tint-${game.tint}`}>
              <span className="plan-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="plan-icon">
                <Icon size={24} aria-hidden="true" />
              </span>
              <span className="plan-text">
                <strong>{game.name}</strong>
                <span>{purpose}</span>
              </span>
              <span className="plan-time">
                <Clock size={14} aria-hidden="true" /> {game.minutes} min
              </span>
            </li>
          );
        })}
      </ol>

      {!demoMode && !connected && (
        <p className="plan-note">
          <Bluetooth size={16} aria-hidden="true" /> Have your AquaGrip on and nearby. Each exercise will help you connect.
        </p>
      )}
      {demoMode && <p className="plan-note">Demo mode: this session won't be saved to your progress.</p>}

      <button className="btn btn-primary btn-block btn-big" onClick={onStart}>
        <Play size={20} fill="currentColor" aria-hidden="true" /> Start session
      </button>
    </>
  );
}
