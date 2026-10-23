import { Plus, UserRound, X } from "lucide-react";
import { setActiveProfile, useProfiles } from "../data/profiles";
import { setGuest } from "../data/guest";
import Avatar from "./Avatar";

// "Who's playing?": pick yourself, add someone, or play as a guest. Shown
// when the app opens with 2+ people set up, from the avatar on Home, and on
// a brand-new install (as a welcome, with no one to pick yet).
export default function WhoIsPlaying({ onDone, onAdd, onClose }) {
  const { profiles, active } = useProfiles();
  const firstRun = profiles.length === 0;

  const pick = (id) => {
    setActiveProfile(id);
    setGuest(false);
    onDone();
  };
  const guest = () => {
    setGuest(true);
    onDone();
  };

  if (firstRun) {
    return (
      <div className="people">
        <div className="people-welcome">
          <span className="people-welcome-mark" aria-hidden="true">
            <UserRound size={40} />
          </span>
          <h1 className="title">Welcome to AirGrip</h1>
          <p className="subtitle">Let's set up your profile. It takes about 30 seconds.</p>
          <button className="btn btn-primary btn-block btn-big" onClick={onAdd}>
            Get started
          </button>
          <button className="link-btn people-guest-link" onClick={guest}>
            Just trying it out? Continue as a guest
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="people">
      {onClose && (
        <div className="game-bar">
          <button className="icon-btn" onClick={onClose} aria-label="Back">
            <X size={22} aria-hidden="true" />
          </button>
        </div>
      )}
      <h1 className="title people-title">Who's playing?</h1>
      <div className="people-grid">
        {profiles.map((p) => (
          <button
            key={p.id}
            className={`people-tile${active?.id === p.id ? " is-current" : ""}`}
            onClick={() => pick(p.id)}
          >
            <Avatar profile={p} size={76} />
            <strong>{p.name}</strong>
          </button>
        ))}
        <button className="people-tile people-tile--add" onClick={onAdd}>
          <span className="people-icon" aria-hidden="true">
            <Plus size={34} />
          </span>
          <strong>Add person</strong>
        </button>
        <button className="people-tile people-tile--guest" onClick={guest}>
          <span className="people-icon" aria-hidden="true">
            <UserRound size={34} />
          </span>
          <strong>Guest</strong>
          <span>Nothing is saved</span>
        </button>
      </div>
    </div>
  );
}
