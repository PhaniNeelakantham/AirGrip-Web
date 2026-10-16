import { ChevronRight, ScanLine } from "lucide-react";
import { useBaseline } from "../data/baseline";
import { useHand } from "../data/hand";

// Home: invite a first baseline assessment; afterwards, a compact summary.
export default function BaselineCard({ demoMode, onStart }) {
  const baseline = useBaseline(demoMode);
  const hand = useHand();

  if (!baseline) {
    return (
      <section className="baseline-card" aria-label="Baseline assessment">
        <div className="baseline-icon">
          <ScanLine size={26} aria-hidden="true" />
        </div>
        <div className="baseline-text">
          <strong>Find your starting point</strong>
          <span>A 1-minute check of your {hand} hand's grip and wrist, so every game matches what you can do.</span>
        </div>
        <button className="btn btn-primary baseline-btn" onClick={onStart}>
          Start
        </button>
      </section>
    );
  }

  const squeeze = (baseline.maxPsi - baseline.restPsi).toFixed(1);
  return (
    <button className="baseline-row" onClick={onStart} aria-label={`Your ${hand}-hand baseline. Redo the baseline assessment`}>
      <ScanLine size={18} aria-hidden="true" />
      <span className="baseline-row-text">
        <strong>{hand === "left" ? "Left" : "Right"}-hand baseline</strong> · squeeze {squeeze} psi · tilt {baseline.pitchUp}°/{baseline.pitchDown}° · turn{" "}
        {baseline.rollRight}°/{baseline.rollLeft}°
        {Number.isFinite(baseline.yawRight) && ` · wave ${baseline.yawRight}°/${baseline.yawLeft}°`}
      </span>
      <span className="baseline-redo">
        Redo <ChevronRight size={16} aria-hidden="true" />
      </span>
    </button>
  );
}
