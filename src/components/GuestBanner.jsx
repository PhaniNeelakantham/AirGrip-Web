import { UserRound } from "lucide-react";
import { nextGuest, setGuest } from "../data/guest";

// Shown on Home and Progress while Guest mode is on, so it's never left on
// by accident.
export default function GuestBanner({ onOpenBaseline }) {
  return (
    <div className="banner tint-lavender guest-banner" role="status">
      <UserRound size={18} aria-hidden="true" />
      <span>
        <strong>Guest mode</strong>: games and baseline aren't saved.
      </span>
      <div className="guest-banner-actions">
        {onOpenBaseline && (
          <button
            className="btn btn-primary guest-next"
            onClick={() => {
              nextGuest();
              onOpenBaseline();
            }}
          >
            Next guest
          </button>
        )}
        <button className="link-btn" onClick={() => setGuest(false)}>
          Turn off
        </button>
      </div>
    </div>
  );
}
