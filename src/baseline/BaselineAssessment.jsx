import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bluetooth, Check, Hand, Move, MoveLeft, MoveRight, RotateCw, ScanLine, X } from "lucide-react";
import { angleDelta, toAngles } from "../ble/orientation";
import { getBaseline, saveBaseline } from "../data/baseline";
import { useDevicePause } from "../games/useDevicePause";
import { useHand } from "../data/hand";
import { getGuest } from "../data/guest";

// Full-screen guided check, in the spirit of Face ID setup: one instruction
// at a time, a ring of ticks that lights up as you squeeze or move, and a
// check mark between steps.

const STEPS = [
  { id: "relax", kind: "rest", icon: Hand, title: "Relax your hand", sub: "Rest it gently on the grip. Don't squeeze.", seconds: 3 },
  {
    id: "squeeze",
    kind: "grip",
    icon: Hand,
    title: "Squeeze as hard as you comfortably can",
    sub: "Keep squeezing until the ring finishes. It shouldn't hurt.",
    seconds: 5,
  },
  { id: "level", kind: "center", icon: Move, title: "Hold your hand level", sub: "Rest your forearm on a table and keep still.", seconds: 2.5 },
  { id: "up", kind: "wrist", axis: "pitch", icon: ArrowUp, title: "Tilt your hand up", sub: "As far as is comfortable, then hold it there.", seconds: 4 },
  { id: "down", kind: "wrist", axis: "pitch", opposite: "up", icon: ArrowDown, title: "Now tilt it down", sub: "As far as is comfortable, then hold it there.", seconds: 4 },
  { id: "right", kind: "wrist", axis: "roll", icon: RotateCw, title: "Turn your wrist to the right", sub: "Like turning a doorknob. Go as far as is comfortable.", seconds: 4 },
  { id: "left", kind: "wrist", axis: "roll", opposite: "right", icon: RotateCw, title: "Now turn it to the left", sub: "Like turning a doorknob the other way.", seconds: 4 },
  {
    id: "sideRight",
    kind: "wrist",
    axis: "yaw",
    icon: MoveRight,
    title: "Wave your hand to the right",
    sub: "Palm down, swing just your hand sideways. Keep your forearm still on the table.",
    seconds: 4,
  },
  {
    id: "sideLeft",
    kind: "wrist",
    axis: "yaw",
    opposite: "sideRight",
    icon: MoveLeft,
    title: "Now wave it to the left",
    sub: "Swing just your hand the other way. Keep your forearm still.",
    seconds: 4,
  },
];

const READY_S = 1.6; // instruction shown before measuring starts
const OK_S = 0.7; // check-mark flash after each step
const TICKS = 72;
const RING_DEG = 60; // wrist angle that fills the whole ring
const MIN_SQUEEZE = { demo: 2, real: 0.5 }; // psi above relaxed needed to count
const MIN_WRIST_DEG = 3; // less than this = we didn't see the movement
const DEMO_MAX_PSI = 10;
const DEMO_TILT_MAX = 55;
const DEMO_YAW_SCALE = 0.55; // side-to-side range is naturally smaller (about 30°)

const isKey = (e, names) => names.includes(e.key) || names.includes(e.code);

function Ring({ fill, mode, timeProgress, children }) {
  const size = 300;
  const c = size / 2;
  const lit = Math.round(Math.max(0, Math.min(1, fill)) * TICKS);
  const r = 146;
  const circ = 2 * Math.PI * r;
  return (
    <div className={`bl-ring bl-ring--${mode}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {Array.from({ length: TICKS }, (_, i) => {
          const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
          const on = mode === "ok" || i < lit;
          return (
            <line
              key={i}
              x1={c + Math.cos(a) * 112}
              y1={c + Math.sin(a) * 112}
              x2={c + Math.cos(a) * 132}
              y2={c + Math.sin(a) * 132}
              className={on ? "bl-tick is-on" : "bl-tick"}
            />
          );
        })}
        {timeProgress !== null && (
          <circle
            cx={c}
            cy={c}
            r={r}
            className="bl-time"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - timeProgress)}
            transform={`rotate(-90 ${c} ${c})`}
          />
        )}
      </svg>
      <div className="bl-ring-center">{children}</div>
    </div>
  );
}

function HoldPad({ held, wristKeys, sideways }) {
  const press = (key, down) => (e) => {
    e.preventDefault();
    if (down) held.current.add(key);
    else held.current.delete(key);
  };
  const handlers = (key) => ({
    onPointerDown: press(key, true),
    onPointerUp: press(key, false),
    onPointerLeave: press(key, false),
    onPointerCancel: press(key, false),
    onContextMenu: (e) => e.preventDefault(),
  });
  if (!wristKeys) {
    return (
      <button className="bl-hold" {...handlers("squeeze")}>
        <Hand size={22} aria-hidden="true" /> Hold to squeeze <span>(or Space)</span>
      </button>
    );
  }
  if (sideways) {
    return (
      <div className="bl-pad bl-pad--row">
        <button aria-label="Wave left" {...handlers("left")}><ArrowLeft size={22} /></button>
        <button aria-label="Wave right" {...handlers("right")}><ArrowRight size={22} /></button>
      </div>
    );
  }
  return (
    <div className="bl-pad">
      <button aria-label="Tilt up" {...handlers("up")}><ArrowUp size={22} /></button>
      <button aria-label="Turn left" {...handlers("left")}><ArrowLeft size={22} /></button>
      <button aria-label="Turn right" {...handlers("right")}><ArrowRight size={22} /></button>
      <button aria-label="Tilt down" {...handlers("down")}><ArrowDown size={22} /></button>
    </div>
  );
}

export default function BaselineAssessment({
  demoMode,
  connectionState,
  readingRef: reading,
  lastDataAtRef,
  onReconnect,
  onClose,
}) {
  const [phase, setPhase] = useState("intro"); // intro | measure | retry | done
  const [view, setView] = useState(null);
  const [notice, setNotice] = useState(null); // why we're back at the start
  const [result, setResult] = useState(null);
  const connected = connectionState === "connected";
  const canStart = demoMode || connected;
  const previous = getBaseline(demoMode);
  const hand = useHand();

  const link = useDevicePause({ active: phase === "measure", demoMode, connectionState, lastDataAtRef });
  if (phase === "measure" && link.paused) {
    setPhase("intro");
    setNotice("AirGrip disconnected during the check. Reconnect, then start again.");
  }

  // Demo controls: Space squeezes, arrow keys tilt and turn.
  const held = useRef(new Set());
  useEffect(() => {
    const map = (e) =>
      isKey(e, ["Space", " "]) ? "squeeze"
        : isKey(e, ["ArrowUp", "w"]) ? "up"
          : isKey(e, ["ArrowDown", "s"]) ? "down"
            : isKey(e, ["ArrowLeft", "a"]) ? "left"
              : isKey(e, ["ArrowRight", "d"]) ? "right"
                : null;
    const down = (e) => {
      const k = map(e);
      if (!k || phase !== "measure") return;
      e.preventDefault();
      if (demoMode) held.current.add(k);
    };
    const up = (e) => {
      const k = map(e);
      if (k) held.current.delete(k);
    };
    const clear = () => held.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [phase, demoMode]);

  // Measurements so far. Kept outside the sequence so retrying one wrist step
  // doesn't throw away the earlier ones.
  const startAt = useRef({ index: 0, stage: "ready" });
  const freshAcc = () => ({ restSum: 0, restN: 0, rest: 0, peak: 0, centerP: 0, centerR: 0, centerY: 0, yawRef: null, centerN: 0, center: { pitch: 0, roll: 0, yaw: 0 } });
  const accRef = useRef(freshAcc());
  const wristRef = useRef({}); // id -> { sign, mag }
  const [retry, setRetry] = useState(null); // { kind: "grip" | "wrist", index }

  // The guided sequence.
  useEffect(() => {
    if (phase !== "measure") return;
    let raf;
    let last = performance.now();
    const demo = { psi: 0, pitch: 0, roll: 0, yaw: 0 };
    const minSqueeze = demoMode ? MIN_SQUEEZE.demo : MIN_SQUEEZE.real;
    const s = { index: startAt.current.index, stage: startAt.current.stage, t: 0 };
    const acc = accRef.current;
    const wrist = wristRef.current;
    let stepMax = { pos: 0, neg: 0 };

    const readInputs = (dt) => {
      if (!demoMode) {
        return { psi: reading.current.forcePsi, angles: toAngles(reading.current) };
      }
      const h = held.current;
      demo.psi = h.has("squeeze") ? Math.min(DEMO_MAX_PSI, demo.psi + 6 * dt) : Math.max(0, demo.psi - 32 * dt);
      const ease = (v, target) => v + Math.max(-60 * dt, Math.min(60 * dt, target - v));
      demo.pitch = ease(demo.pitch, (h.has("up") ? DEMO_TILT_MAX : 0) - (h.has("down") ? DEMO_TILT_MAX : 0));
      const side = (h.has("right") ? DEMO_TILT_MAX : 0) - (h.has("left") ? DEMO_TILT_MAX : 0);
      // Left/right keys turn during the turn steps and wave during the wave steps.
      const waving = STEPS[s.index].axis === "yaw";
      demo.roll = ease(demo.roll, waving ? 0 : side);
      demo.yaw = ease(demo.yaw, waving ? side * DEMO_YAW_SCALE : 0);
      return { psi: demo.psi, angles: { pitch: demo.pitch, roll: demo.roll, yaw: demo.yaw } };
    };

    const finishStep = (step) => {
      if (step.kind === "rest") acc.rest = acc.restN ? acc.restSum / acc.restN : 0;
      if (step.kind === "grip" && acc.peak - acc.rest < minSqueeze) return "retry-grip";
      if (step.kind === "center") {
        const n = Math.max(1, acc.centerN);
        acc.center = { pitch: acc.centerP / n, roll: acc.centerR / n, yaw: (acc.yawRef ?? 0) + acc.centerY / n };
      }
      if (step.kind === "wrist") {
        if (step.opposite) {
          wrist[step.id] = { sign: -wrist[step.opposite].sign, mag: wrist._oppMag ?? 0 };
        } else {
          const sign = stepMax.pos >= -stepMax.neg ? 1 : -1;
          wrist[step.id] = { sign, mag: sign > 0 ? stepMax.pos : -stepMax.neg };
        }
        if (wrist[step.id].mag < MIN_WRIST_DEG) return "retry-wrist";
      }
      return "ok";
    };

    const frame = (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (link.pausedRef.current) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const step = STEPS[s.index];
      const { psi, angles } = readInputs(dt);
      s.t += dt;

      let fill = 0;
      let live = null;

      if (s.stage === "ready") {
        if (s.t >= READY_S) {
          s.stage = "measure";
          s.t = 0;
          stepMax = { pos: 0, neg: 0 };
          wrist._oppMag = 0;
        }
      } else if (s.stage === "measure") {
        if (step.kind === "rest") {
          acc.restSum += psi;
          acc.restN++;
          fill = s.t / step.seconds;
          live = `${Math.max(0, Math.ceil(step.seconds - s.t))}`;
        } else if (step.kind === "grip") {
          const above = Math.max(0, psi - acc.rest);
          acc.peak = Math.max(acc.peak, psi);
          const best = acc.peak - acc.rest;
          fill = above / Math.max(4, best * 1.25);
          live = `${above.toFixed(1)} psi`;
        } else if (step.kind === "center") {
          acc.centerP += angles.pitch;
          acc.centerR += angles.roll;
          // Yaw can sit near the +/-180 seam, so average offsets from the first sample.
          if (acc.yawRef === null) acc.yawRef = angles.yaw;
          acc.centerY += angleDelta(angles.yaw, acc.yawRef);
          acc.centerN++;
          fill = s.t / step.seconds;
          live = "Hold still";
        } else {
          const d = angleDelta(angles[step.axis], acc.center[step.axis]);
          if (step.opposite) {
            const toward = -wrist[step.opposite].sign * d;
            wrist._oppMag = Math.max(wrist._oppMag ?? 0, toward);
            fill = Math.max(0, toward) / RING_DEG;
            live = `${Math.round(Math.max(0, toward))}°`;
          } else {
            stepMax.pos = Math.max(stepMax.pos, d);
            stepMax.neg = Math.min(stepMax.neg, d);
            fill = Math.abs(d) / RING_DEG;
            live = `${Math.round(Math.abs(d))}°`;
          }
        }
        if (s.t >= step.seconds) {
          const outcome = finishStep(step);
          if (outcome !== "ok") {
            setRetry({ kind: outcome === "retry-grip" ? "grip" : "wrist", index: s.index });
            setPhase("retry");
            return;
          }
          s.stage = "ok";
          s.t = 0;
        }
      } else if (s.stage === "ok") {
        fill = 1;
        if (s.t >= OK_S) {
          if (s.index === STEPS.length - 1) {
            const baseline = {
              restPsi: Number(acc.rest.toFixed(3)),
              maxPsi: Number(acc.peak.toFixed(3)),
              pitchUp: Math.round(wrist.up.mag),
              pitchDown: Math.round(wrist.down.mag),
              rollRight: Math.round(wrist.right.mag),
              rollLeft: Math.round(wrist.left.mag),
              pitchUpSign: wrist.up.sign,
              rollRightSign: wrist.right.sign,
              yawRight: Math.round(wrist.sideRight.mag),
              yawLeft: Math.round(wrist.sideLeft.mag),
              yawRightSign: wrist.sideRight.sign,
              at: Date.now(),
            };
            saveBaseline(demoMode, baseline);
            setResult(baseline);
            setPhase("done");
            return;
          }
          s.index++;
          s.stage = "ready";
          s.t = 0;
        }
      }

      setView({
        index: s.index,
        stage: s.stage,
        fill,
        live,
        timeProgress: s.stage === "measure" ? Math.min(1, s.t / step.seconds) : null,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, demoMode, reading, link.pausedRef]);

  // from: where to (re)start. A full start resets every measurement.
  const run = (from = { index: 0, stage: "ready" }) => {
    link.resume();
    held.current.clear();
    if (from.index === 0) {
      accRef.current = freshAcc();
      wristRef.current = {};
    }
    setNotice(null);
    setRetry(null);
    setView(null);
    startAt.current = from;
    setPhase("measure");
  };
  const start = () => run();

  const step = view ? STEPS[view.index] : STEPS[0];
  const StepIcon = step.icon;
  const showDemoPad =
    demoMode && phase === "measure" && view && view.stage !== "ok" && (step.kind === "grip" || step.kind === "wrist");

  return (
    <div className="bl" role="dialog" aria-modal="true" aria-label="Baseline assessment">
      <button className="bl-close" onClick={() => onClose(false)} aria-label="Close">
        <X size={22} aria-hidden="true" />
      </button>

      {phase === "intro" && (
        <div className="bl-body">
          <Ring fill={0.18} mode="idle" timeProgress={null}>
            <ScanLine size={58} aria-hidden="true" />
          </Ring>
          <h1 className="bl-title">Baseline assessment</h1>
          <p className="bl-sub">
            About one minute. Hold the AirGrip in your <strong>{hand} hand</strong>. We'll measure your grip and how
            far your wrist moves, so every game matches what you can do today.
          </p>
          <ol className="bl-steps">
            <li>Relax, then squeeze</li>
            <li>Tilt up and down</li>
            <li>Turn right and left</li>
            <li>Wave side to side</li>
          </ol>
          {notice && <p className="bl-notice">{notice}</p>}
          {previous && (
            <p className="bl-small">Last done {new Date(previous.at).toLocaleDateString()}. Doing it again replaces it.</p>
          )}
          {demoMode && <p className="bl-small">Demo mode: hold Space to squeeze, use the arrow keys to move. Results aren't saved.</p>}
          {canStart ? (
            <button className="bl-btn" onClick={start}>
              Start
            </button>
          ) : (
            <>
              <p className="bl-small">Turn on your AirGrip and connect it first.</p>
              <button className="bl-btn" onClick={onReconnect} disabled={connectionState === "connecting"}>
                <Bluetooth size={18} aria-hidden="true" /> {connectionState === "connecting" ? "Connecting…" : "Connect AirGrip"}
              </button>
            </>
          )}
        </div>
      )}

      {phase === "measure" && view && (
        <div className="bl-body" aria-live="polite">
          <Ring fill={view.stage === "ready" ? 0 : view.fill} mode={view.stage} timeProgress={view.timeProgress}>
            {view.stage === "ok" ? (
              <Check size={72} strokeWidth={3} className="bl-check" aria-hidden="true" />
            ) : (
              <>
                <StepIcon size={46} aria-hidden="true" className={step.id === "left" ? "bl-flip" : undefined} />
                <div className="bl-live">{view.stage === "ready" ? "Get ready…" : view.live}</div>
              </>
            )}
          </Ring>
          <h1 className="bl-title">{step.title}</h1>
          <p className="bl-sub">{step.sub}</p>
          <div className="bl-dots" aria-label={`Step ${view.index + 1} of ${STEPS.length}`}>
            {STEPS.map((st, i) => (
              <span key={st.id} className={i < view.index ? "is-done" : i === view.index ? "is-now" : ""} />
            ))}
          </div>
          {showDemoPad && <HoldPad held={held} wristKeys={step.kind === "wrist"} sideways={step.axis === "yaw"} />}
        </div>
      )}

      {phase === "retry" && (
        <div className="bl-body">
          {retry?.kind === "wrist" ? (
            <>
              <Ring fill={0} mode="idle" timeProgress={null}>
                <RotateCw size={52} aria-hidden="true" />
              </Ring>
              <h1 className="bl-title">We didn't see that movement</h1>
              <p className="bl-sub">
                {STEPS[retry.index].title}, as far as is comfortable, while the ring fills.
                {demoMode ? " In Demo mode, hold the matching arrow key." : ""}
              </p>
              <button className="bl-btn" onClick={() => run({ index: retry.index, stage: "ready" })}>
                Try that step again
              </button>
              {/* For someone who genuinely can't move that way: keep the small value and go on. */}
              <button className="bl-link" onClick={() => run({ index: retry.index, stage: "ok" })}>
                Skip this step
              </button>
            </>
          ) : (
            <>
              <Ring fill={0} mode="idle" timeProgress={null}>
                <Hand size={52} aria-hidden="true" />
              </Ring>
              <h1 className="bl-title">We couldn't feel a squeeze</h1>
              <p className="bl-sub">
                {demoMode
                  ? "Hold Space (or the button) during the squeeze step."
                  : "Make sure your hand is on the grip and squeeze firmly when asked."}
              </p>
              <button className="bl-btn" onClick={start}>
                Try again
              </button>
            </>
          )}
        </div>
      )}

      {phase === "done" && result && (
        <div className="bl-body">
          <Ring fill={1} mode="ok" timeProgress={null}>
            <Check size={72} strokeWidth={3} className="bl-check" aria-hidden="true" />
          </Ring>
          <h1 className="bl-title">All set!</h1>
          <p className="bl-sub">Your games are now tuned to your range. You can redo this anytime from Home.</p>
          <div className="bl-results">
            <div>
              <span>Comfortable squeeze</span>
              <strong>{(result.maxPsi - result.restPsi).toFixed(1)} psi</strong>
            </div>
            <div>
              <span>Tilt up / down</span>
              <strong>
                {result.pitchUp}° / {result.pitchDown}°
              </strong>
            </div>
            <div>
              <span>Turn right / left</span>
              <strong>
                {result.rollRight}° / {result.rollLeft}°
              </strong>
            </div>
            <div>
              <span>Wave right / left</span>
              <strong>
                {result.yawRight}° / {result.yawLeft}°
              </strong>
            </div>
          </div>
          {demoMode ? (
            <p className="bl-small">Demo mode: kept for this visit only.</p>
          ) : getGuest() ? (
            <p className="bl-small">Guest mode: kept only until the next guest.</p>
          ) : null}
          <button className="bl-btn" onClick={() => onClose(true)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
