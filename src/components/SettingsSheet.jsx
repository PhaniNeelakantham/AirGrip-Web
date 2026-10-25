import { useEffect } from "react";
import { useScrollLock } from "../hooks/useScrollLock";
import { createPortal } from "react-dom";
import { Check, Hand, ScanLine, X } from "lucide-react";
import { setHand, useHand } from "../data/hand";
import { useBaseline } from "../data/baseline";
import { useGuest } from "../data/guest";
import { setDevMode, useDevMode } from "../data/devMode";
import { useProfiles } from "../data/profiles";
import Avatar from "../profiles/Avatar";

const HANDS = [
  { id: "left", label: "Left hand" },
  { id: "right", label: "Right hand" },
];

// Settings sheet: profile, hand, Developer mode
export default function SettingsSheet({ demoMode, onClose, onOpenBaseline, onSwitchPerson, onEditProfile }) {
  const { active } = useProfiles();
  const hand = useHand();
  const baseline = useBaseline(demoMode);
  const guest = useGuest();
  const devMode = useDevMode();

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { backdropRef, panelRef: sheetRef } = useScrollLock(); // freeze the page behind the panel

  return createPortal(
    <div className="sheet-backdrop" ref={backdropRef} onClick={onClose}>
      <div
        className="sheet"
        ref={sheetRef}
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

        {active && (
          <div className="sheet-profile">
            <Avatar profile={active} size={52} />
            <div className="sheet-profile-text">
              <strong>{active.name}</strong>
              <span>
                Goal: {active.weeklyGoal} sessions a week{active.ageRange ? ` · ${active.ageRange}` : ""}
              </span>
            </div>
            <div className="sheet-profile-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  onClose();
                  onEditProfile();
                }}
              >
                Edit profile
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  onClose();
                  onSwitchPerson();
                }}
              >
                Switch person
              </button>
            </div>
          </div>
        )}

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
          Hold the AirGrip in this hand. Each hand keeps its own baseline and progress, so you can train
          one or both.
        </p>

        {!baseline && !guest && (
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


        <div className="sheet-divider" />
        <label className="switch-row sheet-switch">
          <span>
            <strong>Developer mode</strong>
          </span>
          <button className="switch" role="switch" aria-checked={devMode} onClick={() => setDevMode(!devMode)} />
        </label>
      </div>
    </div>,
    document.body
  );
}
