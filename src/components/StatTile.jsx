import { ArrowDown, ArrowUp, Minus } from "lucide-react";

// Signed change chip: icon + number, so direction never relies on color alone.
// goodWhen: "up" (rising is good), "down" (falling is good), or null (neutral).
// suffix "%" for relative change, " pts" for a difference in points.
export function DeltaChip({ value, goodWhen = "up", suffix = "%" }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const improved = goodWhen === "down" ? rounded < 0 : rounded > 0;
  const tone = rounded === 0 || goodWhen === null ? "flat" : improved ? "good" : "bad";
  const Icon = rounded > 0 ? ArrowUp : rounded < 0 ? ArrowDown : Minus;
  const unitWord = suffix === "%" ? "percent" : "points";
  const spoken = rounded === 0 ? "no change" : `${rounded > 0 ? "up" : "down"} ${Math.abs(rounded)} ${unitWord}`;

  return (
    <span className={`delta delta--${tone}`} aria-label={spoken}>
      <Icon size={14} strokeWidth={3} aria-hidden="true" />
      {Math.abs(rounded)}
      {suffix}
    </span>
  );
}

export default function StatTile({ icon: Icon, tint, label, value, unit, delta }) {
  return (
    <div className={`stat tint-${tint}`}>
      <div className="stat-icon">
        <Icon size={20} strokeWidth={2.2} aria-hidden="true" />
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      <DeltaChip value={delta} />
    </div>
  );
}
