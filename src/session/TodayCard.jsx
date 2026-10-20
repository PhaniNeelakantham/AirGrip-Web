import { Check, Clock, Play } from "lucide-react";
import { isPlanDoneToday, planFrom, planMinutes, usePlanIds } from "./plan";

// Home screen's main action: start (or redo) today's guided session.
export default function TodayCard({ demoMode, onStart }) {
  const done = isPlanDoneToday(demoMode);
  const plan = planFrom(usePlanIds()); // the games picked last time

  return (
    <section className={`today-card${done ? " is-done" : ""}`} aria-label="Today's session">
      <div className="today-top">
        <div>
          <div className="today-label">{done ? "Done for today" : "Today's session"}</div>
          <div className="today-title">
            {done ? "Nice work! You finished today's exercises." : `${plan.length} short exercises for your hand and wrist`}
          </div>
        </div>
        {done && (
          <span className="today-check" aria-hidden="true">
            <Check size={22} strokeWidth={3} />
          </span>
        )}
      </div>

      <div className="today-steps" aria-hidden="true">
        {plan.map(({ gameId, game }) => {
          const Icon = game.icon;
          return (
            <span key={gameId} className={`today-step tint-${game.tint}`} title={game.name}>
              <Icon size={18} />
            </span>
          );
        })}
        <span className="today-time">
          <Clock size={14} /> about {planMinutes(plan)} min
        </span>
      </div>

      <button className={`btn btn-block btn-big ${done ? "btn-secondary" : "btn-primary"}`} onClick={onStart}>
        <Play size={18} fill="currentColor" aria-hidden="true" /> {done ? "Do it again" : "Start today's session"}
      </button>
    </section>
  );
}
