import { Check, Play } from "lucide-react";
import { MIN_PLAN_GAMES, PLAYABLE_GAMES, isPlanDoneToday } from "./plan";

// Home screen's main action: build today's guided session
export default function TodayCard({ demoMode, onStart }) {
  const done = isPlanDoneToday(demoMode);

  return (
    <section className={`today-card${done ? " is-done" : ""}`} aria-label="Today's session">
      <div className="today-top">
        <div>
          <div className="today-label">{done ? "Done for today" : "Today's session"}</div>
          <div className="today-title">
            {done ? "Nice work! You finished today's exercises." : "Choose your games for today"}
          </div>
        </div>
        {done && (
          <span className="today-check" aria-hidden="true">
            <Check size={22} strokeWidth={3} />
          </span>
        )}
      </div>

      <div className="today-steps" aria-hidden="true">
        {PLAYABLE_GAMES.map((game) => {
          const Icon = game.icon;
          return (
            <span key={game.id} className={`today-step tint-${game.tint}`} title={game.name}>
              <Icon size={18} />
            </span>
          );
        })}
        <span className="today-time">pick {MIN_PLAN_GAMES} or more</span>
      </div>

      <button className={`btn btn-block btn-big ${done ? "btn-secondary" : "btn-primary"}`} onClick={onStart}>
        <Play size={18} fill="currentColor" aria-hidden="true" /> {done ? "Do another session" : "Build today's session"}
      </button>
    </section>
  );
}
