import { BluetoothConnected, BluetoothOff } from "lucide-react";

// Shown over a paused game: first while the device is gone, then once it's
// back, asking the player to get ready and tap Resume.
export default function ConnectionPause({ lost, silent = false, connecting, readyHint, onReconnect, onResume, onEnd }) {
  return (
    <div className="game-overlay">
      <div className="overlay-card" role="alertdialog" aria-live="assertive" aria-label="Game paused">
        <div className={`overlay-icon ${lost ? "tint-peach" : "tint-mint"}`}>
          {lost ? <BluetoothOff size={30} aria-hidden="true" /> : <BluetoothConnected size={30} aria-hidden="true" />}
        </div>
        <h2>{silent ? "Waiting for the sensor" : lost ? "AquaGrip disconnected" : "Connected again"}</h2>
        <p className="overlay-note">
          {silent
            ? "Still connected, but the motion sensor stopped sending. It usually restarts by itself in a few seconds. Hold still."
            : lost
              ? "Your game is paused. Make sure the device is on and nearby, then tap Reconnect."
              : `${readyHint} Then tap Resume.`}
        </p>
        {silent ? null : lost ? (
          <button className="btn btn-primary btn-block" onClick={onReconnect} disabled={connecting}>
            {connecting ? "Connecting…" : "Reconnect"}
          </button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={onResume}>
            Resume
          </button>
        )}
        <button className="btn btn-secondary btn-block" onClick={onEnd}>
          End game
        </button>
      </div>
    </div>
  );
}
