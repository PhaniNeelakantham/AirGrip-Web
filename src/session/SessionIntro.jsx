import { useState } from "react";
import { Bluetooth, Check, Clock, Play, Sparkles, X } from "lucide-react";
import { MIN_PLAN_GAMES, PLAYABLE_GAMES, getPlanIds, planFrom, planMinutes } from "./plan";

const LEVEL_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" };

// Before a session: pick the games (at least 2). They're played in the order
// they were picked, shown by the number on each tile.
export default function SessionIntro({ demoMode, connectionState, onStart, onExit }) {
  const connected = connectionState === "connected";
  const [picked, setPicked] = useState(() => getPlanIds());
  const plan = planFrom(picked);
  const enough = plan.length >= MIN_PLAN_GAMES;

  const toggle = (id) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
            <Sparkles size={15} aria-hidden="true" /> Build your session
          </div>
          <div className="hero-value">
            {plan.length} {plan.length === 1 ? "game" : "games"} · about {planMinutes(plan)} min
          </div>
          <p className="hero-note">Tap the games you'd like to play today. Pick at least {MIN_PLAN_GAMES}.</p>
        </div>
      </section>

      <div className="pick-grid" role="group" aria-label="Choose games for today's session">
        {PLAYABLE_GAMES.map((game) => {
          const Icon = game.icon;
          const order = picked.indexOf(game.id);
          const on = order >= 0;
          return (
            <button
              key={game.id}
              className={`pick-tile tint-${game.tint}${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(game.id)}
            >
              <span className="pick-art" aria-hidden="true">
                <Icon size={40} strokeWidth={1.8} />
              </span>
              <strong className="pick-name">{game.name}</strong>
              <span className="pick-meta">
                {game.trains} · {game.minutes} min
              </span>
              {game.level && <span className="pick-level">{LEVEL_LABEL[game.level]}</span>}
              <span className="pick-badge" aria-hidden="true">
                {on ? order + 1 : <Check size={16} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>

      {plan.length > 0 && (
        <ol className="pick-order" aria-label="Your session, in order">
          {plan.map(({ gameId, game, purpose }, i) => (
            <li key={gameId}>
              <span className="pick-order-num">{i + 1}</span>
              <span>
                <strong>{game.name}</strong> · {purpose}
              </span>
              <span className="plan-time">
                <Clock size={13} aria-hidden="true" /> {game.minutes} min
              </span>
            </li>
          ))}
        </ol>
      )}

      {!demoMode && !connected && (
        <p className="plan-note">
          <Bluetooth size={16} aria-hidden="true" /> Have your AquaGrip on and nearby. Each exercise will help you connect.
        </p>
      )}
      {demoMode && <p className="plan-note">Demo mode: this session won't be saved to your progress.</p>}

      <button
        className="btn btn-primary btn-block btn-big"
        onClick={() => onStart(picked)}
        disabled={!enough}
      >
        <Play size={20} fill="currentColor" aria-hidden="true" />{" "}
        {enough ? "Start session" : `Pick ${MIN_PLAN_GAMES - plan.length} more`}
      </button>
    </>
  );
}
