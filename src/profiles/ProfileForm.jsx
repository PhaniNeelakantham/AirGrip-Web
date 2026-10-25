import { useState } from "react";
import { ArrowLeft, Check, Hand, ScanLine, Trash2, X } from "lucide-react";
import {
  AGE_RANGES,
  AVATAR_COLORS,
  DEFAULT_WEEKLY_GOAL,
  WEEKLY_GOALS,
  addProfile,
  deleteProfile,
  getProfiles,
  updateProfile,
} from "../data/profiles";
import { setGuest } from "../data/guest";
import Avatar from "./Avatar";

const HANDS = [
  { id: "left", label: "Left hand" },
  { id: "right", label: "Right hand" },
];

function ColorPicker({ value, onChange }) {
  return (
    <div className="color-row" role="radiogroup" aria-label="Color">
      {AVATAR_COLORS.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={`Color ${c}`}
          className={`color-dot${value === c ? " is-on" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        >
          {value === c && <Check size={18} strokeWidth={3} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

function Choices({ options, value, onChange, label, big = false }) {
  return (
    <div className={`choice-grid${big ? " choice-grid--big" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.id)}
          role="radio"
          aria-checked={value === o.id}
          className={`choice${value === o.id ? " is-on" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const handOptions = HANDS.map((h) => ({
  ...h,
  icon: <Hand size={30} aria-hidden="true" className={h.id === "left" ? "hand-flip" : undefined} />,
}));
const goalOptions = WEEKLY_GOALS.map((n) => ({ id: n, label: `${n} times a week` }));
const ageOptions = AGE_RANGES.map((a) => ({ id: a, label: a }));

// Adding someone: one question per screen, big buttons, the extras skippable
export default function ProfileForm({ profile = null, onClose, onCreated, onDeleted, onBaseline }) {
  const editing = profile !== null;
  const [fields, setFields] = useState(() => ({
    name: profile?.name ?? "",
    color: profile?.color ?? AVATAR_COLORS[getProfiles().length % AVATAR_COLORS.length],
    hand: profile?.hand ?? "right",
    weeklyGoal: profile?.weeklyGoal ?? DEFAULT_WEEKLY_GOAL,
    ageRange: profile?.ageRange ?? null,
  }));
  const [step, setStep] = useState(0); // creating: 0 name, 1 hand, 2 goal, 3 age
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch) => setFields((f) => ({ ...f, ...patch }));
  const named = fields.name.trim().length > 0;

  const nameField = (
    <>
      <label className="form-label" htmlFor="profile-name">
        Name or nickname
      </label>
      <input
        id="profile-name"
        className="form-input"
        value={fields.name}
        maxLength={24}
        autoComplete="off"
        onChange={(e) => set({ name: e.target.value })}
      />
      <div className="form-label">Pick a color</div>
      <ColorPicker value={fields.color} onChange={(color) => set({ color })} />
    </>
  );

  if (editing) {
    const save = () => {
      updateProfile(profile.id, fields);
      onClose();
    };
    return (
      <div className="people">
        <div className="game-bar">
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden="true" />
          </button>
          <div className="game-bar-title">Edit profile</div>
        </div>
        <div className="form-preview">
          <Avatar profile={{ ...fields, name: fields.name || profile.name }} size={72} />
        </div>
        {nameField}
        <div className="form-label">Hand you're training</div>
        <Choices label="Hand" options={handOptions} value={fields.hand} onChange={(hand) => set({ hand })} />
        <div className="form-label">Weekly goal</div>
        <Choices label="Weekly goal" options={goalOptions} value={fields.weeklyGoal} onChange={(weeklyGoal) => set({ weeklyGoal })} />
        <div className="form-label">Age range (optional)</div>
        <Choices
          label="Age range"
          options={[...ageOptions, { id: null, label: "Prefer not to say" }]}
          value={fields.ageRange}
          onChange={(ageRange) => set({ ageRange })}
        />
        <button className="btn btn-primary btn-block btn-big form-save" onClick={save} disabled={!named}>
          Save
        </button>

        {!confirmDelete ? (
          <button className="link-btn form-delete" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} aria-hidden="true" /> Delete this profile
          </button>
        ) : (
          <div className="confirm-box" role="alertdialog" aria-label="Delete profile">
            <p>
              Delete <strong>{profile.name}</strong> and all their progress on this device? This can't be undone.
            </p>
            <div className="confirm-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  deleteProfile(profile.id);
                  onDeleted();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- Adding someone, one step at a time ----
  const steps = 4;
  const create = () => {
    addProfile(fields);
    setGuest(false);
    onCreated?.();
    setStep(4);
  };
  const back = () => (step === 0 ? onClose() : setStep(step - 1));

  return (
    <div className="people">
      {step < 4 && (
        <div className="game-bar">
          <button className="icon-btn" onClick={back} aria-label={step === 0 ? "Close" : "Back"}>
            {step === 0 ? <X size={22} aria-hidden="true" /> : <ArrowLeft size={22} aria-hidden="true" />}
          </button>
          <div className="game-bar-title">Add person</div>
          <div className="form-steps" aria-label={`Step ${step + 1} of ${steps}`}>
            {Array.from({ length: steps }, (_, i) => (
              <span key={i} className={i <= step ? "is-done" : ""} />
            ))}
          </div>
        </div>
      )}

      {step === 0 && (
        <>
          <h1 className="title form-q">What should we call you?</h1>
          <div className="form-preview">
            <Avatar profile={{ ...fields, name: fields.name || "?" }} size={72} />
          </div>
          {nameField}
          <button className="btn btn-primary btn-block btn-big form-next" onClick={() => setStep(1)} disabled={!named}>
            Next
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="title form-q">Which hand are you training?</h1>
          <p className="subtitle">Hold the AirGrip in this hand. You can switch anytime in Settings.</p>
          <Choices big label="Hand" options={handOptions} value={fields.hand} onChange={(hand) => set({ hand })} />
          <button className="btn btn-primary btn-block btn-big form-next" onClick={() => setStep(2)}>
            Next
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="title form-q">How often would you like to practice?</h1>
          <p className="subtitle">Your weekly goal. Ask your therapist if you're not sure.</p>
          <Choices
            big
            label="Weekly goal"
            options={goalOptions}
            value={fields.weeklyGoal}
            onChange={(weeklyGoal) => set({ weeklyGoal })}
          />
          <button className="btn btn-primary btn-block btn-big form-next" onClick={() => setStep(3)}>
            Next
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="title form-q">What's your age range?</h1>
          <p className="subtitle">Optional. It's only saved on this device and included in exports for your therapist.</p>
          <Choices big label="Age range" options={ageOptions} value={fields.ageRange} onChange={(ageRange) => set({ ageRange })} />
          <button className="btn btn-primary btn-block btn-big form-next" onClick={create}>
            {fields.ageRange ? "Finish" : "Skip and finish"}
          </button>
        </>
      )}

      {step === 4 && (
        <div className="people-welcome">
          <Avatar profile={fields} size={88} />
          <h1 className="title">All set, {fields.name.trim()}!</h1>
          <p className="subtitle">Next, a 1-minute check of your grip and wrist so every game matches what you can do.</p>
          <button className="btn btn-primary btn-block btn-big" onClick={onBaseline}>
            <ScanLine size={20} aria-hidden="true" /> Find my starting point
          </button>
          <button className="link-btn people-guest-link" onClick={onClose}>
            Later
          </button>
        </div>
      )}
    </div>
  );
}
