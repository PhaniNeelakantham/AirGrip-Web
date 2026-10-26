import { useEffect, useState } from "react";

// Progress ring that eases from its previous value to the new one
export default function ScoreRing({
  value,
  max = 100,
  size = 128,
  stroke = 12,
  color = "var(--teal)",
  trackColor = "var(--gridline)",
  children,
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // Two frames so the starting offset is painted before it changes
    let inner;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(value));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [value]);

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = Math.max(0, Math.min(1, shown / max));
  const c = size / 2;

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          className="ring-progress"
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
