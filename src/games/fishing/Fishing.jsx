import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Fish as FishIcon, Hand, Move, Timer, Trophy, X } from "lucide-react";
import { addSession } from "../../data/sessionStore";
import { getCalibration, getPlayCalibration } from "../../data/gripCalibration";
import { getBaseline, wristTuning } from "../../data/baseline";
import { REP_LOW, createRepCounter, toLevel } from "../squeezePop/logic";
import {
  AIM_HOLD_S,
  AIM_TOLERANCE,
  CAST_GOAL,
  FISH,
  HOOK_HOLD_S,
  LIFT_GOAL,
  createReel,
  fishAim,
  toReach,
} from "./logic";
import { useDevicePause } from "../useDevicePause";
import { getGuest, notSavedText } from "../../data/guest";
import { useDevMode } from "../../data/devMode";
import ConnectionPause from "../ConnectionPause";
import ResultActions, { StepTag } from "../ResultActions";
import { createGripTracker, createTremorTracker } from "../metrics";
import { angleDelta, toAngles } from "../../ble/orientation";

// One catch, one movement at a time: wave to aim, tilt up then down to
// cast, squeeze to hook, turn back and forth to reel in.

const CAST_S = 0.7; // bobber flight
const CAUGHT_S = 1.8; // "You caught..." card
const WAIT_MIN_S = 1.2; // time before a bite
const WAIT_EXTRA_S = 1.4;
const FINISH_DELAY = 0.2;
const DEMO_MAX_PSI = 10;
const DEMO_RISE = 6;
const DEMO_FALL = 32;
const DEMO_MOVE = 2.5; // pretend reach per second while an arrow is held (tilt, turn)
const YAW_SMOOTH_S = 0.2; // the side-to-side reading is smoothed over about this long

// Scene geometry (SVG units). The rod pivots at the shore, bottom center.
const VB_W = 360;
const VB_H = 460;
const PX = 180;
const PY = 432;
const ROD_LEN = 118;
const FISH_DIST = 236;
const AIM_DEG = 40; // reach 1 points the rod this far left/right
const RING_R = 30;
const RING_LEN = 2 * Math.PI * RING_R;
const AIM_RING_LEN = 2 * Math.PI * (RING_R + 6);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const polar = (deg, dist) => ({
  x: PX + Math.sin((deg * Math.PI) / 180) * dist,
  y: PY - Math.cos((deg * Math.PI) / 180) * dist,
});

// Where a new fish first appears, so it doesn't flash elsewhere for a frame.
const fishStart = (aim) => {
  const p = polar(aim * AIM_DEG, FISH_DIST);
  return `translate(${p.x.toFixed(1)} ${(p.y + 14).toFixed(1)})`;
};

function FishShape({ color, size = 1, shadow = false }) {
  return (
    <g transform={`scale(${size})`}>
      <path d="M16 0 L32 -11 L29 0 L32 11 Z" fill={shadow ? "var(--fish-shadow)" : color} />
      <ellipse rx="22" ry="11" fill={shadow ? "var(--fish-shadow)" : color} />
      {!shadow && (
        <>
          <path d="M-4 -10 Q4 -18 10 -9" fill={color} stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
          <circle cx="-12" cy="-3" r="2.6" fill="#1b2433" />
          <circle cx="-12.8" cy="-3.8" r="0.9" fill="#fff" />
        </>
      )}
    </g>
  );
}

function DemoControls({ held, stage }) {
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
  if (stage === "hook" || stage === "wait") {
    return (
      <div className="hold-wrap">
        <button className="hold-btn" {...handlers("squeeze")}>
          <Hand size={24} aria-hidden="true" /> Hold to squeeze
        </button>
        <p className="game-hint">or hold the Space bar</p>
      </div>
    );
  }
  const vertical = stage === "lift" || stage === "cast";
  const btn = (key, Icon, label) => (
    <button className="pad-btn" aria-label={label} {...handlers(key)}>
      <Icon size={26} strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
  return (
    <div className="fish-demo">
      <div className="fish-pad">
        {vertical ? (
          <>
            {btn("up", ArrowUp, "Tilt up")}
            {btn("down", ArrowDown, "Tilt down")}
          </>
        ) : (
          <>
            {btn("left", ArrowLeft, stage === "reel" ? "Turn left" : "Wave left")}
            {btn("right", ArrowRight, stage === "reel" ? "Turn right" : "Wave right")}
          </>
        )}
      </div>
      <p className="game-hint">
        {vertical ? "or the Up / Down keys" : stage === "reel" ? "Tap left and right in turn (or the arrow keys)" : "or the Left / Right keys"}
      </p>
    </div>
  );
}

function instructionFor(view) {
  if (!view) return "";
  switch (view.stage) {
    case "aim":
      return view.onTarget ? "That's it, hold it there…" : "Wave your hand to point the rod at the fish.";
    case "lift":
      return view.lifted ? "Now tilt your hand down to cast!" : "Tilt your hand up to lift the rod.";
    case "cast":
      return "Here it goes…";
    case "wait":
      return "Wait for a bite…";
    case "hook":
      return "A bite! Squeeze to hook it.";
    case "reel":
      return "Turn your wrist back and forth to reel it in.";
    case "caught":
      return `You caught a ${view.fish.name}!`;
    default:
      return "";
  }
}

const REAL_HINTS = {
  aim: "Keep your forearm on the table and swing just your hand.",
  lift: "Tilt gently. You don't need to go far.",
  cast: "",
  wait: "Relax your hand while you wait.",
  hook: "Keep squeezing until the ring fills.",
  reel: "Like turning a doorknob one way, then the other.",
  caught: "",
};

export default function Fishing({
  connectionState,
  readingRef: reading,
  lastDataAtRef,
  demoMode,
  onExit,
  onReconnect,
  onOpenBaseline,
  sessionStep = null,
  sessionGroupId = null,
  onNext,
}) {
  const [phase, setPhase] = useState("intro"); // intro | playing | done
  const [view, setView] = useState(null);
  const [result, setResult] = useState(null);
  const link = useDevicePause({ active: phase === "playing", demoMode, connectionState, lastDataAtRef });

  const held = useRef(new Set());
  const center = useRef({ pitch: 0, roll: 0, yaw: 0 });
  const el = useRef({}); // scene parts updated every frame

  const connected = connectionState === "connected";
  const canStart = demoMode || connected;
  const baseline = getBaseline(demoMode);
  // Demo mode plays with default ranges; the baseline is optional there.
  // Developer mode (Settings) skips it on the real device too.
  const devMode = useDevMode();
  const hasBaseline = demoMode || devMode || (baseline !== null && getCalibration(false) !== null);
  const hasYaw = Number.isFinite(baseline?.yawRight);

  // Demo controls: arrow keys / WASD move, Space squeezes.
  useEffect(() => {
    const map = (e) =>
      e.code === "Space" ? "squeeze"
        : ["ArrowUp", "KeyW"].includes(e.code) ? "up"
          : ["ArrowDown", "KeyS"].includes(e.code) ? "down"
            : ["ArrowLeft", "KeyA"].includes(e.code) ? "left"
              : ["ArrowRight", "KeyD"].includes(e.code) ? "right"
                : null;
    const onDown = (e) => {
      const k = map(e);
      if (!k || phase !== "playing") return;
      e.preventDefault();
      if (demoMode) held.current.add(k);
    };
    const onUp = (e) => {
      const k = map(e);
      if (k) held.current.delete(k);
    };
    const clear = () => held.current.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    };
  }, [phase, demoMode]);

  const finish = useCallback(
    (g) => {
      const span = (r) => Math.round(r.max - r.min);
      const ranges = { pitch: span(g.range.pitch), roll: span(g.range.roll), yaw: span(g.range.yaw) };
      const rangeDeg = Math.max(ranges.pitch, ranges.roll, ranges.yaw);
      const peak = Number(g.peak.toFixed(2));
      const ttt = g.timesToTarget;
      if (!demoMode) {
        addSession({
          game: "fishing",
          timestamp: Date.now(),
          durationS: Math.round(g.elapsed),
          peakForcePsi: peak,
          avgForcePsi: g.squeezeFrames ? Number((g.squeezeSum / g.squeezeFrames).toFixed(2)) : 0,
          reps: g.reps.count,
          rotationRangeDeg: rangeDeg,
          pitchRangeDeg: ranges.pitch,
          rollRangeDeg: ranges.roll,
          yawRangeDeg: ranges.yaw,
          ...g.grip.result(),
          ...g.tremor.result(),
          timeToTargetS: ttt.length ? Number((ttt.reduce((a, v) => a + v, 0) / ttt.length).toFixed(2)) : null,
          ...(sessionGroupId && { groupId: sessionGroupId }),
        });
      }
      setResult({ caught: g.caught, timeS: Math.round(g.elapsed), peak, rangeDeg, saved: !demoMode && !getGuest() });
      setPhase("done");
    },
    [demoMode, sessionGroupId]
  );

  // Main game loop.
  useEffect(() => {
    if (phase !== "playing") return;
    const cal = getPlayCalibration(demoMode, reading.current.forcePsi);
    const tune = wristTuning(getBaseline(demoMode));
    const demo = { psi: 0, yaw: 0, pitch: 0, roll: 0 };
    const g = {
      yawF: 0, // smoothed side-to-side reading (steadier rod)
      index: 0,
      stage: "aim",
      t: 0,
      fish: FISH[0],
      aim: fishAim(0),
      aimHold: 0,
      lifted: false,
      wait: 0,
      hookHold: 0,
      hookReached: false,
      reel: createReel(),
      reelStart: 0,
      progress: 0,
      caught: 0,
      finishing: null,
      elapsed: 0,
      peak: 0,
      squeezeSum: 0,
      squeezeFrames: 0,
      reps: createRepCounter(),
      grip: createGripTracker(),
      tremor: createTremorTracker(),
      lastSample: null,
      lastSampleAt: 0,
      timesToTarget: [],
      range: {
        pitch: { min: 0, max: 0 },
        roll: { min: 0, max: 0 },
        yaw: { min: 0, max: 0 },
      },
    };
    let raf;
    let last = performance.now();
    let lastSignature = null;

    const ease = (v, target, dt) => v + clamp(target - v, -DEMO_MOVE * dt, DEMO_MOVE * dt);
    const readInputs = (dt) => {
      if (demoMode) {
        const h = held.current;
        const side = (h.has("right") ? 1 : 0) - (h.has("left") ? 1 : 0);
        demo.psi = h.has("squeeze")
          ? Math.min(DEMO_MAX_PSI, demo.psi + DEMO_RISE * dt)
          : Math.max(0, demo.psi - DEMO_FALL * dt);
        // Left/right waves while aiming and turns while reeling.
        if (g.stage === "aim") demo.yaw = clamp(demo.yaw + side * 1.2 * dt, -1.15, 1.15);
        demo.roll = ease(demo.roll, g.stage === "reel" ? side * 0.8 : 0, dt);
        demo.pitch = ease(demo.pitch, (h.has("up") ? 1 : 0) - (h.has("down") ? 1 : 0), dt);
        return { psi: demo.psi, yaw: demo.yaw, pitch: demo.pitch, roll: demo.roll };
      }
      const a = toAngles(reading.current);
      const c = center.current;
      const deg = {
        pitch: angleDelta(a.pitch, c.pitch) * tune.pitchUpSign,
        roll: angleDelta(a.roll, c.roll) * tune.rollRightSign,
        yaw: angleDelta(a.yaw, c.yaw) * tune.yawRightSign,
      };
      for (const axis of ["pitch", "roll", "yaw"]) {
        const r = g.range[axis];
        r.min = Math.min(r.min, deg[axis]);
        r.max = Math.max(r.max, deg[axis]);
      }
      // Wrist steadiness from each new sensor reading (not each screen frame).
      const sample = reading.current;
      if (sample !== g.lastSample) {
        const at = lastDataAtRef.current;
        if (g.lastSample) g.tremor.add(a, (at - g.lastSampleAt) / 1000);
        g.lastSample = sample;
        g.lastSampleAt = at;
      }
      return {
        psi: sample.forcePsi,
        yaw: toReach(deg.yaw, tune.yawFull.right, tune.yawFull.left),
        pitch: toReach(deg.pitch, tune.full.up, tune.full.down),
        roll: toReach(deg.roll, tune.full.right, tune.full.left),
      };
    };

    const nextFish = () => {
      g.index++;
      g.fish = FISH[g.index];
      g.aim = fishAim(g.index);
      g.aimHold = 0;
      g.lifted = false;
      g.hookHold = 0;
      g.hookReached = false;
      g.progress = 0;
      g.stage = "aim";
      g.t = 0;
    };

    const draw = (inp, level) => {
      const e = el.current;
      const aimAngle = g.stage === "aim" ? clamp(inp.yaw, -1.15, 1.15) * AIM_DEG : g.aim * AIM_DEG;
      const tip = polar(aimAngle, ROD_LEN);
      const spot = polar(g.aim * AIM_DEG, FISH_DIST);
      e.rod?.setAttribute("transform", `rotate(${aimAngle.toFixed(2)} ${PX} ${PY})`);

      // Bobber: flies out while casting, sits by the fish, comes in while reeling.
      let bob = spot;
      if (g.stage === "cast") {
        const u = Math.min(1, g.t / CAST_S);
        bob = { x: tip.x + (spot.x - tip.x) * u, y: tip.y + (spot.y - tip.y) * u - Math.sin(Math.PI * u) * 46 };
      } else if (g.stage === "reel" || g.stage === "caught") {
        bob = polar(g.aim * AIM_DEG, FISH_DIST - (FISH_DIST - ROD_LEN - 20) * Math.min(1, g.progress));
      }
      e.bobber?.setAttribute("transform", `translate(${bob.x.toFixed(1)} ${bob.y.toFixed(1)})`);
      if (e.line) {
        e.line.setAttribute("x1", tip.x.toFixed(1));
        e.line.setAttribute("y1", tip.y.toFixed(1));
        e.line.setAttribute("x2", bob.x.toFixed(1));
        e.line.setAttribute("y2", bob.y.toFixed(1));
      }
      const fishAt = g.stage === "reel" ? bob : spot;
      e.fish?.setAttribute("transform", `translate(${fishAt.x.toFixed(1)} ${(fishAt.y + 14).toFixed(1)})`);
      e.aimRing?.setAttribute("stroke-dashoffset", (AIM_RING_LEN * (1 - g.aimHold / AIM_HOLD_S)).toFixed(1));
      e.hookRing?.setAttribute("stroke-dashoffset", (RING_LEN * (1 - g.hookHold / HOOK_HOLD_S)).toFixed(1));

      if (e.tiltFill) {
        const p = clamp(inp.pitch, -1, 1) * 50;
        e.tiltFill.style.bottom = p >= 0 ? "50%" : `${50 + p}%`;
        e.tiltFill.style.height = `${Math.abs(p)}%`;
      }
      if (e.gripFill) e.gripFill.style.height = `${Math.min(1, level) * 100}%`;
      if (e.reelBar) e.reelBar.style.width = `${Math.min(1, g.progress) * 100}%`;
      e.reelSpin?.setAttribute("transform", `rotate(${(g.progress * 900).toFixed(1)} ${PX + 34} ${PY - 6})`);
    };

    const step = (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (link.pausedRef.current) {
        raf = requestAnimationFrame(step);
        return;
      }
      g.elapsed += dt;
      g.t += dt;

      const inp = readInputs(dt);
      // Smooth the side-to-side reading so small wobbles don't jerk the rod.
      g.yawF += (inp.yaw - g.yawF) * Math.min(1, dt / YAW_SMOOTH_S);
      inp.yaw = g.yawF;
      const level = toLevel(inp.psi, cal);
      const above = Math.max(0, inp.psi - cal.restPsi);
      g.peak = Math.max(g.peak, above);
      if (level > REP_LOW) {
        g.squeezeSum += above;
        g.squeezeFrames++;
      }
      g.reps.update(level);
      g.grip.update(level, dt);

      let onTarget = false;
      if (g.finishing !== null) {
        g.finishing -= dt;
        if (g.finishing <= 0) {
          finish(g);
          return;
        }
      } else if (g.stage === "aim") {
        onTarget = Math.abs(inp.yaw - g.aim) < AIM_TOLERANCE;
        g.aimHold = onTarget ? g.aimHold + dt : Math.max(0, g.aimHold - dt * 0.6);
        if (g.aimHold >= AIM_HOLD_S) {
          g.stage = "lift";
          g.t = 0;
        }
      } else if (g.stage === "lift") {
        if (!g.lifted && inp.pitch >= LIFT_GOAL) g.lifted = true;
        if (g.lifted && inp.pitch <= CAST_GOAL) {
          g.stage = "cast";
          g.t = 0;
        }
      } else if (g.stage === "cast") {
        if (g.t >= CAST_S) {
          g.stage = "wait";
          g.t = 0;
          g.wait = WAIT_MIN_S + Math.random() * WAIT_EXTRA_S;
        }
      } else if (g.stage === "wait") {
        if (g.t >= g.wait) {
          g.stage = "hook";
          g.t = 0;
        }
      } else if (g.stage === "hook") {
        const strong = level >= g.fish.grip;
        if (strong && !g.hookReached) {
          g.hookReached = true;
          g.timesToTarget.push(g.t);
        }
        g.hookHold = strong ? g.hookHold + dt : Math.max(0, g.hookHold - dt * 0.6);
        if (g.hookHold >= HOOK_HOLD_S) {
          g.stage = "reel";
          g.t = 0;
          g.reelStart = g.reel.update(inp.roll, dt);
        }
      } else if (g.stage === "reel") {
        g.progress = (g.reel.update(inp.roll, dt) - g.reelStart) / g.fish.reel;
        if (g.progress >= 1) {
          g.progress = 1;
          g.caught++;
          g.stage = "caught";
          g.t = 0;
        }
      } else if (g.stage === "caught") {
        if (g.t >= CAUGHT_S) {
          if (g.index + 1 >= FISH.length) g.finishing = FINISH_DELAY;
          else nextFish();
        }
      }
      if (g.stage !== "reel") g.reel.update(inp.roll, dt); // keep the smoothing warm

      draw(inp, level);

      // Only discrete changes re-render through React.
      const signature = [g.index, g.stage, g.lifted, onTarget, g.caught].join("|");
      if (signature !== lastSignature) {
        lastSignature = signature;
        setView({
          index: g.index,
          stage: g.stage,
          lifted: g.lifted,
          onTarget,
          fish: g.fish,
          aim: g.aim,
          caught: g.caught,
          goal: g.fish.grip,
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, demoMode, reading, lastDataAtRef, finish, link.pausedRef]);

  const recenter = () => {
    if (!demoMode) center.current = toAngles(reading.current);
  };

  const begin = () => {
    if (!hasBaseline) return; // the start card offers the baseline instead
    held.current.clear();
    recenter();
    link.resume();
    setResult(null);
    setView(null);
    setPhase("playing");
  };

  const playing = phase === "playing" && view !== null;
  const stage = view?.stage;
  const instruction = playing ? instructionFor(view) : "";
  const showLine = playing && ["cast", "wait", "hook", "reel"].includes(stage);
  const showFish = playing && stage !== "caught";
  const fishVisible = stage === "reel"; // hooked: shown in color

  const setEl = (name) => (node) => {
    el.current[name] = node;
  };

  return (
    <>
      <div className="game-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Leave game">
          <X size={22} aria-hidden="true" />
        </button>
        <div className="game-bar-title">
          Fishing
          <StepTag sessionStep={sessionStep} />
        </div>
        <div className="game-timer" aria-label="Fish caught">
          <FishIcon size={16} aria-hidden="true" />
          {phase === "done" ? result?.caught : (view?.caught ?? 0)} / {FISH.length}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {instruction}
      </p>

      <div className="fish-area">
        <div className="fish-shore" aria-hidden="true" />
        <svg className="fish-scene" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <g className="fish-ripples">
            <ellipse cx="70" cy="120" rx="26" ry="6" />
            <ellipse cx="290" cy="80" rx="18" ry="4" />
            <ellipse cx="250" cy="250" rx="30" ry="7" />
            <ellipse cx="95" cy="300" rx="20" ry="5" />
          </g>

          {showFish && (
            <g ref={setEl("fish")} transform={fishStart(view.aim)}>
              <g className={fishVisible ? "fish-hooked" : "fish-swim"}>
                <FishShape color={view.fish.color} size={view.fish.size} shadow={!fishVisible} />
              </g>
              {stage === "aim" && <circle r={RING_R + 6} className="fish-ring-track" />}
              {stage === "aim" && (
                // Fills while the rod points at the fish.
                <circle
                  ref={setEl("aimRing")}
                  r={RING_R + 6}
                  className={`fish-ring${view.onTarget ? " is-on" : ""}`}
                  strokeDasharray={AIM_RING_LEN}
                  strokeDashoffset={AIM_RING_LEN}
                  transform="rotate(-90)"
                />
              )}
            </g>
          )}

          {showLine && <line ref={setEl("line")} className="fish-line" />}
          {showLine && (
            <g ref={setEl("bobber")}>
              <g className={stage === "hook" ? "bobber is-bite" : stage === "wait" ? "bobber is-floating" : "bobber"}>
                <circle r="8" className="bobber-bottom" />
                <path d="M-8 0 A8 8 0 0 1 8 0 Z" className="bobber-top" />
              </g>
              {stage === "hook" && <circle r={RING_R} className="fish-ring-track" />}
              {stage === "hook" && (
                <circle
                  ref={setEl("hookRing")}
                  r={RING_R}
                  className="fish-ring"
                  strokeDasharray={RING_LEN}
                  strokeDashoffset={RING_LEN}
                  transform="rotate(-90)"
                />
              )}
            </g>
          )}

          {playing && (
            <g ref={setEl("rod")}>
              <line x1={PX} y1={PY} x2={PX} y2={PY - ROD_LEN} className="fish-rod" />
              <circle cx={PX} cy={PY - ROD_LEN} r="3.5" className="fish-rod-tip" />
            </g>
          )}
          <circle cx={PX} cy={PY} r="9" className="fish-handle" />
          {playing && stage === "reel" && (
            <g className="fish-reel">
              <circle cx={PX + 34} cy={PY - 6} r="15" />
              <g ref={setEl("reelSpin")}>
                <line x1={PX + 34} y1={PY - 6} x2={PX + 34} y2={PY - 21} />
                <circle cx={PX + 34} cy={PY - 21} r="4" />
              </g>
            </g>
          )}
        </svg>

        {playing && (
          <div className={`fish-tip${stage === "hook" ? " is-alert" : ""}`} aria-hidden="true">
            {instruction}
          </div>
        )}

        {playing && stage === "lift" && (
          <div className="tilt-meter" aria-hidden="true">
            <span className="tilt-meter-mid" />
            <span ref={setEl("tiltFill")} className="tilt-meter-fill" />
            <span className={`tilt-meter-goal${view.lifted ? "" : " is-next"}`} style={{ bottom: `${50 + LIFT_GOAL * 50}%` }} />
            <span className={`tilt-meter-goal${view.lifted ? " is-next" : ""}`} style={{ bottom: `${50 + CAST_GOAL * 50}%` }} />
            <ArrowUp size={14} className="tilt-meter-label tilt-meter-label--up" />
            <ArrowDown size={14} className="tilt-meter-label tilt-meter-label--down" />
          </div>
        )}

        {playing && (stage === "hook" || stage === "wait") && (
          <div className="squeeze-meter" aria-hidden="true">
            <div ref={setEl("gripFill")} className="squeeze-fill" style={{ height: 0 }} />
            <div className="squeeze-goal" style={{ bottom: `${view.goal * 100}%` }} />
          </div>
        )}

        {playing && stage === "reel" && (
          <div className="reel-progress" aria-hidden="true">
            <span ref={setEl("reelBar")} />
          </div>
        )}

        {playing && stage === "caught" && (
          <div className="catch-card" role="status">
            <svg viewBox="-40 -24 80 48" width="120" height="72" aria-hidden="true">
              <FishShape color={view.fish.color} />
            </svg>
            <strong>{view.fish.name}!</strong>
            <span>
              {view.caught} of {FISH.length} in the bucket
            </span>
          </div>
        )}

        {phase === "intro" && (
          <div className="game-overlay">
            <div className="overlay-card">
              <div className="overlay-icon tint-mint">
                <FishIcon size={30} aria-hidden="true" />
              </div>
              <h2>Go fishing</h2>
              <ol className="steps">
                <li>Wave your hand left or right to point the rod at the fish.</li>
                <li>Tilt your hand up to lift the rod, then down to cast.</li>
                <li>When the bobber dips, squeeze to hook the fish.</li>
                <li>Turn your wrist back and forth to reel it in.</li>
              </ol>
              {!demoMode && hasBaseline && (
                <p className="overlay-note">
                  <Move size={14} aria-hidden="true" /> Rest your forearm on the table with your hand level, then tap Start.
                </p>
              )}
              {!hasBaseline && (
                <p className="overlay-note">
                  First, take the 1-minute baseline assessment so every move matches your range.
                </p>
              )}
              {demoMode && !baseline && (
                <p className="overlay-note">
                  Optional:{" "}
                  <button className="link-btn link-btn--inline" onClick={onOpenBaseline}>
                    try the baseline assessment
                  </button>{" "}
                  to tune every move to your range. Not needed in Demo mode.
                </p>
              )}
              {baseline && !hasYaw && (
                <p className="overlay-note">
                  Tip: redo the baseline on Home to tune the side-to-side aim to your wrist.
                </p>
              )}
              {demoMode && (
                <p className="overlay-note">Demo mode: use the arrow keys and Space (or the buttons). Not saved to your progress.</p>
              )}
              {hasBaseline && !canStart && (
                <p className="overlay-note">Connect your AquaGrip first, or turn on Demo mode to try it with the keyboard.</p>
              )}
              {!hasBaseline ? (
                <button className="btn btn-primary btn-block" onClick={onOpenBaseline}>
                  Start baseline assessment
                </button>
              ) : canStart ? (
                <button className="btn btn-primary btn-block" onClick={begin}>
                  Start
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-block"
                  onClick={onReconnect}
                  disabled={connectionState === "connecting"}
                >
                  {connectionState === "connecting" ? "Connecting…" : "Connect device"}
                </button>
              )}
            </div>
          </div>
        )}

        {phase === "playing" && link.paused && (
          <ConnectionPause
            lost={link.lost}
            silent={link.silent}
            connecting={connectionState === "connecting"}
            readyHint="Rest your forearm on the table with your hand level."
            onReconnect={onReconnect}
            onResume={() => {
              recenter();
              link.resume();
            }}
            onEnd={onExit}
          />
        )}

        {phase === "done" && result && (
          <div className="game-overlay">
            <div className="overlay-card">
              <div className="overlay-icon tint-mint">
                <FishIcon size={30} aria-hidden="true" />
              </div>
              <h2>A full bucket!</h2>
              <div className="result-stats result-stats--3">
                <div>
                  <FishIcon size={18} aria-hidden="true" />
                  <strong>
                    {result.caught}/{FISH.length}
                  </strong>
                  <span>caught</span>
                </div>
                <div>
                  <Trophy size={18} aria-hidden="true" />
                  <strong>{result.peak.toFixed(1)}</strong>
                  <span>best psi</span>
                </div>
                <div>
                  <Timer size={18} aria-hidden="true" />
                  <strong>
                    {Math.floor(result.timeS / 60)}:{String(result.timeS % 60).padStart(2, "0")}
                  </strong>
                  <span>time</span>
                </div>
              </div>
              <p className="overlay-note">
                {result.saved ? "Saved to your progress." : notSavedText(demoMode)}
              </p>
              <ResultActions
                sessionStep={sessionStep}
                onNext={() => onNext?.(result)}
                onPlayAgain={begin}
                onExit={onExit}
              />
            </div>
          </div>
        )}
      </div>

      {playing &&
        stage !== "caught" &&
        stage !== "cast" &&
        (demoMode ? (
          <DemoControls held={held} stage={stage} />
        ) : (
          REAL_HINTS[stage] && (
            <p className="game-hint" style={{ marginTop: 16, textAlign: "center" }}>
              {REAL_HINTS[stage]}
            </p>
          )
        ))}
    </>
  );
}

