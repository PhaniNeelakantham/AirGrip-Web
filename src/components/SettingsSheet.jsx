import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, Hand, ScanLine, X } from "lucide-react";
import { setHand, useHand } from "../data/hand";
import { useBaseline } from "../data/baseline";

const HANDS = [
  { id: "left", label: "Left hand" },
  { id: "right", label: "Right hand" },
];

// Settings, opened from the gear on Home. For now: which hand is training.
// Rendered on <body>: the animated screen it opens from would otherwise pin
// this "fixed" sheet to the page instead of the window.
export default function SettingsSheet({ demoMode, onClose, onOpenBaseline }) {
  const hand = useHand();
  const baseline = useBaseline(demoMode);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="settings-title">Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <h3 className="sheet-label">Which hand are you training?</h3>
        <div className="hand-choice" role="radiogroup" aria-label="Training hand">
          {HANDS.map((h) => (
            <button
              key={h.id}
              role="radio"
              aria-checked={hand === h.id}
              className={`hand-option${hand === h.id ? " is-on" : ""}`}
              onClick={() => setHand(h.id)}
            >
              <Hand size={34} aria-hidden="true" className={h.id === "left" ? "hand-flip" : undefined} />
              <span>{h.label}</span>
              {hand === h.id && <Check size={18} className="hand-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <p className="sheet-note">
          Hold the AquaGrip in this hand. Each hand keeps its own baseline and progress, so you can train
          one or both.
        </p>

        {!baseline && (
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              onClose();
              onOpenBaseline();
            }}
          >
            <ScanLine size={18} aria-hidden="true" /> Take the baseline for your {hand} hand
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
