import { FlaskConical } from "lucide-react";

export default function DemoBanner({ onNavigate }) {
  return (
    <div className="banner tint-butter" role="status">
      <FlaskConical size={18} aria-hidden="true" />
      <span>
        Showing <strong>sample data</strong>. Turn off Demo mode in{" "}
        <button className="link-btn" onClick={() => onNavigate("games")}>
          Games
        </button>{" "}
        to see your own.
      </span>
    </div>
  );
}
