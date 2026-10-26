import { Gamepad2, House, TrendingUp } from "lucide-react";

const ITEMS = [
  { id: "home", label: "Home", icon: House },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "progress", label: "Progress", icon: TrendingUp },
];

export default function BottomNav({ tab, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className="nav-item"
          aria-current={tab === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          <Icon size={22} strokeWidth={2.2} aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
