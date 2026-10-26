import { Check, Flame } from "lucide-react";

export default function WeekStreak({ days, streak }) {
  return (
    <div className="card">
      <div className="week">
        {days.map((d) => (
          <div
            key={d.label}
            className={`day${d.isToday ? " is-today" : ""}`}
            aria-label={`${d.label}${d.isToday ? " (today)" : ""}: ${d.done ? "practiced" : "no session"}`}
          >
            <span aria-hidden="true">{d.label}</span>
            <span
              className={`day-dot${d.done ? " is-done" : ""}${d.isToday ? " is-today" : ""}`}
              aria-hidden="true"
            >
              {d.done ? <Check size={18} strokeWidth={3} /> : d.dayNum}
            </span>
          </div>
        ))}
      </div>
      <div className="streak-note">
        <span className="streak-icon">
          <Flame size={18} aria-hidden="true" />
        </span>
        {streak > 1
          ? `${streak}-day streak. Keep it going!`
          : streak === 1
            ? "1 day in a row. Come back tomorrow to build a streak!"
            : "Start a streak with a quick session today."}
      </div>
    </div>
  );
}
