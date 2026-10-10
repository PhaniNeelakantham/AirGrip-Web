import { useId, useMemo, useRef, useState } from "react";
import { useElementWidth } from "../hooks/useElementWidth";

const HEIGHT = 200;
const PAD = { top: 22, right: 14, bottom: 30, left: 34 };

const shortDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Single-series trend (dataviz skill specs): 2px line, ~10% area wash,
// 8px end dot with a surface ring, sparse direct label, hairline grid,
// crosshair + tooltip on hover/arrow keys, and a table fallback.
// dataKey: which measurement is shown. Changing it keeps the chart (axes stay
// put), clears the hover, and fades the new line in.
export default function LineChart({ points, valueLabel, unit = "", valueFormat = (v) => v.toFixed(1), dataKey = "" }) {
  const wrapRef = useRef(null);
  const width = useElementWidth(wrapRef);
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const [shownKey, setShownKey] = useState(dataKey);
  if (dataKey !== shownKey) {
    setShownKey(dataKey);
    setHoverIndex(null);
  }

  const geo = useMemo(() => {
    if (points.length === 0 || width === 0) return null;
    const values = points.map((p) => p.value);
    const times = points.map((p) => p.timestamp);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const spread = rawMax - rawMin || 1;
    // Don't pad below 0 for all-positive data (e.g. psi), but let the scale go
    // negative when the data does (e.g. fatigue), so nothing draws off-chart.
    const minY = rawMin >= 0 ? Math.max(0, rawMin - spread * 0.2) : rawMin - spread * 0.2;
    const maxY = rawMax + spread * 0.2;
    const minT = Math.min(...times);
    const spreadT = Math.max(...times) - minT || 1;

    const innerW = width - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const baseY = PAD.top + innerH;
    const toY = (v) => PAD.top + innerH - ((v - minY) / (maxY - minY)) * innerH;

    const scaled = points.map((p) => ({
      ...p,
      x: points.length === 1 ? PAD.left + innerW / 2 : PAD.left + ((p.timestamp - minT) / spreadT) * innerW,
      y: toY(p.value),
    }));

    const line = scaled.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    const area = `${line} L${scaled[scaled.length - 1].x},${baseY} L${scaled[0].x},${baseY} Z`;
    const ticks = [0, 0.5, 1].map((f) => {
      const v = minY + (maxY - minY) * f;
      return { v, y: toY(v) };
    });

    // A visible 0 line when the data crosses zero (e.g. fatigue: below = weaker).
    const zeroY = minY < 0 && maxY > 0 ? toY(0) : null;

    return { scaled, line, area, ticks, baseY, zeroY };
  }, [points, width]);

  const pickNearest = (clientX) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    let best = 0;
    geo.scaled.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(geo.scaled[best].x - x)) best = i;
    });
    setHoverIndex(best);
  };

  const handleKeyDown = (e) => {
    if (!geo) return;
    const last = geo.scaled.length - 1;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setHoverIndex((i) => Math.max(0, (i ?? last) - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setHoverIndex((i) => Math.min(last, (i ?? last) + 1));
    }
  };

  const last = geo?.scaled[geo.scaled.length - 1];
  const hovered = geo && hoverIndex !== null ? geo.scaled[hoverIndex] : null;
  const tooltipLeft = hovered ? Math.min(Math.max(hovered.x, 56), width - 56) : 0;

  return (
    <div>
      <div className="chart" ref={wrapRef}>
        {points.length === 0 && <p className="card-sub">No sessions in this time range yet.</p>}
        {geo && (
          <svg
            width={width}
            height={HEIGHT}
            tabIndex={0}
            role="img"
            aria-label={`${valueLabel} over time. Use left and right arrow keys to step through sessions.`}
            style={{ touchAction: "pan-y" }}
            onPointerMove={(e) => pickNearest(e.clientX)}
            onPointerDown={(e) => pickNearest(e.clientX)}
            onPointerLeave={() => setHoverIndex(null)}
            onFocus={() => setHoverIndex(geo.scaled.length - 1)}
            onBlur={() => setHoverIndex(null)}
            onKeyDown={handleKeyDown}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--teal)" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {geo.ticks.map((t, i) => (
              <g key={i}>
                <line x1={PAD.left} x2={width - PAD.right} y1={t.y} y2={t.y} stroke="var(--gridline)" strokeWidth={1} />
                <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" fontSize={12} fill="var(--ink-3)">
                  {valueFormat(t.v)}
                </text>
              </g>
            ))}

            {/* Re-created when the measurement changes, so only the data fades in. */}
            <g key={dataKey} className="chart-series">
              <path d={geo.area} fill={`url(#${gradientId})`} />
              <path
                d={geo.line}
                fill="none"
                stroke="var(--teal)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
            {geo.zeroY !== null && (
              <g>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={geo.zeroY}
                  y2={geo.zeroY}
                  stroke="var(--axis)"
                  strokeWidth={1.5}
                />
                <text x={PAD.left - 8} y={geo.zeroY + 4} textAnchor="end" fontSize={12} fill="var(--ink-2)">
                  0
                </text>
              </g>
            )}

            <text x={PAD.left} y={HEIGHT - 8} fontSize={12} fill="var(--ink-3)">
              {shortDate(geo.scaled[0].timestamp)}
            </text>
            <text x={width - PAD.right} y={HEIGHT - 8} textAnchor="end" fontSize={12} fill="var(--ink-3)">
              {shortDate(last.timestamp)}
            </text>

            {hovered ? (
              <>
                <line x1={hovered.x} x2={hovered.x} y1={PAD.top} y2={geo.baseY} stroke="var(--axis)" strokeWidth={1} />
                <circle cx={hovered.x} cy={hovered.y} r={6} fill="var(--surface)" />
                <circle cx={hovered.x} cy={hovered.y} r={4} fill="var(--teal)" />
              </>
            ) : (
              <g key={`end-${dataKey}`} className="chart-series">
                <circle cx={last.x} cy={last.y} r={6} fill="var(--surface)" />
                <circle cx={last.x} cy={last.y} r={4} fill="var(--teal)" />
                <text
                  x={last.x}
                  y={last.y - 12}
                  textAnchor="end"
                  fontSize={13}
                  fontWeight={700}
                  fill="var(--ink)"
                  stroke="var(--surface)"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {valueFormat(last.value)}
                </text>
              </g>
            )}
          </svg>
        )}

        {hovered && (
          <div className="chart-tooltip" style={{ left: tooltipLeft, top: hovered.y - 12 }}>
            <strong>
              {valueFormat(hovered.value)} {unit}
            </strong>
            {shortDate(hovered.timestamp)}
          </div>
        )}
      </div>

      {points.length > 0 && (
        <button className="link-btn" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          {showTable ? "Hide the numbers" : "Show the numbers"}
        </button>
      )}

      {showTable && points.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.id}>
                <td>{shortDate(p.timestamp)}</td>
                <td className="num">
                  {valueFormat(p.value)} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
