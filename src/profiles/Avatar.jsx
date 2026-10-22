import { initialsOf } from "../data/profiles";

// A person's initials on their color, so they can find themselves at a glance.
export default function Avatar({ profile, size = 40 }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: profile?.color ?? "#5b6cf0" }}
      aria-hidden="true"
    >
      {initialsOf(profile?.name)}
    </span>
  );
}
