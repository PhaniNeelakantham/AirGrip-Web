import { useState } from "react";
import { Download, Info } from "lucide-react";
import { ADVANCED_METRICS, METRIC_GROUPS, formatMetric, sessionsToCsv, tremorWords } from "../data/advancedMetrics";
import { useProfiles } from "../data/profiles";
import { averageOf, percentChange } from "../data/scoring";
import { DeltaChip } from "./StatTile";
import LineChart from "./LineChart";

function changeFor(metric, now, before) {
  if (!metric.better) return null;
  const a = averageOf(now, metric.key);
  const b = averageOf(before, metric.key);
  if (a === null || b === null) return null;
  return metric.delta === "points" ? a - b : percentChange(a, b);
}

function MetricTile({ metric, value, change }) {
  const [open, setOpen] = useState(false);
  const words = metric.key === "tremorDeg" ? tremorWords(value) : null;
  return (
    <div className="adv-tile">
      <div className="adv-head">
        <span className="adv-label">{metric.label}</span>
        <button
          className="adv-info"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`What is ${metric.label}?`}
        >
          <Info size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="adv-value">
        {formatMetric(metric, value)}
        {value !== null && <span className="stat-unit">{metric.unit}</span>}
      </div>
      {words && <div className="adv-words">{words}</div>}
      <DeltaChip value={change} goodWhen={metric.better} suffix={metric.delta === "points" ? " pts" : "%"} />
      {open && <p className="adv-explain">{metric.explain}</p>}
    </div>
  );
}

// Extra detail for patients who want to learn more and for therapists
export default function AdvancedDetails({ inRange, now, before, compare, allSessions, demoMode }) {
  const { active } = useProfiles();
  const person = demoMode ? null : active;
  const available = ADVANCED_METRICS.filter((m) => inRange.some((s) => Number.isFinite(s[m.key])));
  const [chartKey, setChartKey] = useState("tremorDeg");
  const chartMetric = available.find((m) => m.key === chartKey) ?? available[0];

  const download = () => {
    const blob = new Blob([sessionsToCsv(allSessions, person)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const who = person ? `${person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-` : "";
    a.download = `aquagrip-${demoMode ? "sample-" : who}sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="adv" aria-label="Advanced details">
      <p className="adv-note">
        These numbers help you and your therapist spot trends over time. They are not a medical diagnosis.
        <span className="section-note"> Changes are {compare}.</span>
      </p>

      {METRIC_GROUPS.map((group) => (
        <div key={group.id}>
          <h3 className="adv-group">{group.label}</h3>
          <div className="adv-grid">
            {ADVANCED_METRICS.filter((m) => m.group === group.id).map((m) => (
              <MetricTile key={m.key} metric={m} value={averageOf(inRange, m.key)} change={changeFor(m, now, before)} />
            ))}
          </div>
        </div>
      ))}

      {chartMetric && (
        <>
          <h3 className="adv-group">Trend</h3>
          <section className="card">
            <div className="chip-row" role="group" aria-label="Measurement to chart">
              {available.map((m) => (
                <button
                  key={m.key}
                  className="chip-btn"
                  aria-pressed={m.key === chartMetric.key}
                  onClick={() => setChartKey(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <LineChart
              dataKey={chartMetric.key}
              points={inRange
                .filter((s) => Number.isFinite(s[chartMetric.key]))
                .map((s) => ({ id: s.id, timestamp: s.timestamp, value: s[chartMetric.key] }))}
              valueLabel={chartMetric.label}
              unit={chartMetric.unit}
              valueFormat={(v) => v.toFixed(chartMetric.digits)}
            />
          </section>
        </>
      )}

      <button className="btn btn-secondary btn-block adv-download" onClick={download} disabled={!allSessions.length}>
        <Download size={18} aria-hidden="true" /> Download my data (CSV)
      </button>
      <p className="adv-note adv-note--small">
        A spreadsheet of every session{demoMode ? " (sample data in Demo mode)" : ""}, to share with a therapist.
      </p>
    </section>
  );
}
