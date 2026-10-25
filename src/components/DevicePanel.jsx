import { useState } from "react";
import { Bluetooth, Crosshair, Smartphone, Usb } from "lucide-react";
import { angleDelta, toAngles } from "../ble/orientation";
import { getCalibration } from "../data/gripCalibration";
import { ZERO_READING } from "../ble/useAirGripSensor";
import ConnectionDetails from "./ConnectionDetails";
import { phoneMotionSupported } from "../ble/phoneMotion";

const MAX_METER_PSI = 12;
const AXIS_RANGE_DEG = 90;

const AXES = [
  { key: "pitch", label: "Tilt", hint: "up / down" },
  { key: "roll", label: "Roll", hint: "palm turn" },
  { key: "yaw", label: "Twist", hint: "side to side" },
];

// Vertical slider: 0° in the middle, up for positive
function AxisBar({ label, hint, degrees }) {
  const clamped = Math.max(-AXIS_RANGE_DEG, Math.min(AXIS_RANGE_DEG, degrees));
  const pct = 50 + (clamped / AXIS_RANGE_DEG) * 50;
  return (
    <div className="axis" role="meter" aria-label={`${label} ${Math.round(degrees)} degrees`}
      aria-valuemin={-AXIS_RANGE_DEG} aria-valuemax={AXIS_RANGE_DEG} aria-valuenow={Math.round(clamped)}>
      <strong className="axis-value">{Math.round(degrees)}°</strong>
      <div className="axis-track">
        <div className="axis-center" />
        <div className="axis-fill" style={{ bottom: `${Math.min(pct, 50)}%`, top: `${100 - Math.max(pct, 50)}%` }} />
        <div className="axis-knob" style={{ bottom: `${pct}%` }} />
      </div>
      <div className="axis-label">{label}</div>
      <div className="axis-hint">{hint}</div>
    </div>
  );
}

// The sensor reads absolute pressure, so the meter shows squeeze *above* rest
const PLACEHOLDER_PSI = 0.5;
const MAX_JUMP_PSI = 1.5;

function LiveMeters({ reading, demoMode, noGrip = false }) {
  const [center, setCenter] = useState({ pitch: 0, roll: 0, yaw: 0 });
  const [lowest, setLowest] = useState(null);
  const [prev, setPrev] = useState(null); // the previous believable reading
  const isRealSample = reading !== ZERO_READING && reading.forcePsi > PLACEHOLDER_PSI;
  if (isRealSample && reading !== prev) {
    const steady = prev !== null && Math.abs(reading.forcePsi - prev.forcePsi) < MAX_JUMP_PSI;
    if (steady && (lowest === null || reading.forcePsi < lowest)) setLowest(reading.forcePsi);
    setPrev(reading);
  }

  const calibration = demoMode ? null : getCalibration(false);
  const restPsi = calibration?.restPsi ?? lowest ?? reading.forcePsi;
  const spanPsi = calibration ? calibration.maxPsi - calibration.restPsi : MAX_METER_PSI;
  const squeezePsi = Math.max(0, reading.forcePsi - restPsi);
  const squeezePct = Math.min(1, squeezePsi / spanPsi) * 100;
  const angles = toAngles(reading);

  return (
    <div className="meters">
      <div hidden={noGrip}>
        <div className="meter-head">
          <span>Squeeze</span>
          <strong>{squeezePsi.toFixed(1)} psi</strong>
        </div>
        <div className="meter-track">
          <div className="meter-fill" style={{ width: `${squeezePct}%` }} />
        </div>
      </div>
      <div>
        <div className="meter-head">
          <span>Wrist movement</span>
          <button className="link-btn" onClick={() => setCenter(angles)}>
            <Crosshair size={14} aria-hidden="true" /> Set as center
          </button>
        </div>
        <div className="axes">
          {AXES.map(({ key, label, hint }) => (
            <AxisBar key={key} label={label} hint={hint} degrees={angleDelta(angles[key], center[key])} />
          ))}
        </div>
      </div>
    </div>
  );
}

const usbSupported = typeof navigator !== "undefined" && "serial" in navigator;

function TransportToggle({ transport, onChange }) {
  return (
    <div className="transport">
      <div className="segmented segmented--small" role="group" aria-label="Connect with">
        <button aria-pressed={transport === "ble"} onClick={() => onChange("ble")}>
          <Bluetooth size={16} aria-hidden="true" /> Bluetooth
        </button>
        <button aria-pressed={transport === "usb"} onClick={() => onChange("usb")} disabled={!usbSupported}>
          <Usb size={16} aria-hidden="true" /> USB cable
        </button>
        <button aria-pressed={transport === "phone"} onClick={() => onChange("phone")} disabled={!phoneMotionSupported()}>
          <Smartphone size={16} aria-hidden="true" /> This phone
        </button>
      </div>
      {!usbSupported && transport !== "phone" && (
        <p className="transport-note">USB connection needs Chrome or Edge on a computer.</p>
      )}
      {transport === "phone" && (
        <p className="transport-note">
          No AirGrip? Use this phone's motion sensor for the wrist game. Hold the phone flat in your hand, screen up.
          Grip games need the AirGrip.
        </p>
      )}
    </div>
  );
}

export default function DevicePanel({ sensor, demoMode, onDemoModeChange, transport, onTransportChange }) {
  const { connectionState, reading, error, connect, disconnect } = sensor;
  const connected = connectionState === "connected";
  const usb = transport === "usb";
  const phone = transport === "phone";

  const title = connected
    ? demoMode
      ? "Demo mode is on"
      : phone
        ? "Using this phone's motion sensor"
        : usb
          ? "AirGrip connected by USB"
          : "AirGrip connected"
    : connectionState === "connecting"
      ? "Connecting…"
      : "No device connected";

  const sub = connected
    ? demoMode
      ? "Showing sample movement so you can explore."
      : phone
        ? "Tilt and turn the phone in your hand. The bars will follow."
        : "Squeeze and turn your wrist. The meters will follow."
    : demoMode
      ? "Try everything with sample data. No device needed."
      : phone
        ? "Tap Connect to use this phone's motion sensor. Wrist games only."
        : usb
          ? "Plug the device into the computer, close the Arduino Serial Monitor, then tap Connect."
          : "Tap Connect to play.";

  return (
    <section className="card">
      <div className="device-head" aria-live="polite">
        <div className={`device-badge${connected ? " is-on" : ""}`}>
          {phone && !demoMode ? <Smartphone size={24} aria-hidden="true" /> : <Bluetooth size={24} aria-hidden="true" />}
        </div>
        <div>
          <div className="device-title">{title}</div>
          <div className="device-sub">{sub}</div>
        </div>
      </div>

      {!demoMode && <TransportToggle transport={transport} onChange={onTransportChange} />}
      {connected && <LiveMeters reading={reading} demoMode={demoMode} noGrip={phone && !demoMode} />}
      {error && <p className="device-error">{error}</p>}

      <div className="device-actions">
        {connected ? (
          <button className="btn btn-secondary" onClick={disconnect}>
            {demoMode ? "Stop demo" : "Disconnect"}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={connect}
            disabled={connectionState === "connecting"}
          >
            {demoMode ? "Start demo" : "Connect"}
          </button>
        )}
        <label className="switch-row">
          Demo mode
          <button
            className="switch"
            role="switch"
            aria-checked={demoMode}
            onClick={() => onDemoModeChange(!demoMode)}
          />
        </label>
      </div>

      <ConnectionDetails
        diagnostics={sensor.diagnostics}
        reading={reading}
        status={sensor.status}
        connectionState={connectionState}
      />
    </section>
  );
}
