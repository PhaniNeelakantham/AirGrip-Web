import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Flower2, Hand, Sprout, Timer, Trophy, X } from "lucide-react";
import { addSession } from "../../data/sessionStore";
import { getCalibration, getPlayCalibration } from "../../data/gripCalibration";
import { getBaseline, tiltTuning } from "../../data/baseline";
import { getGuest, notSavedText } from "../../data/guest";
import { useDevMode } from "../../data/devMode";
import { REP_LOW, createRepCounter, toLevel } from "../squeezePop/logic";
import { useDevicePause } from "../useDevicePause";
import ConnectionPause from "../ConnectionPause";
import ResultActions, { StepTag } from "../ResultActions";
import { createGripTracker, createTremorTracker } from "../metrics";
import { angleDelta, toAngles } from "../../ble/orientation";

// Garden Watering: one flower at a time, one move at a time.
//   1. Squeeze gently and hold in the green zone -> the tap fills the can.
//   2. Tilt your hand down -> the can tips and waters the flower.
//   3. The flower blooms; a new sprout appears. Five flowers.
// Nothing can be failed: leaving the zone or tilting back just pauses.

const FLOWERS = [
  { name: "Tulip", petal: "#ff5d73", center: "#ffd166" },
  { name: "Sunflower", petal: "#ffc93c", center: "#7a4a1e" },
  { name: "Daisy", petal: "#ffffff", center: "#ffcf3f" },
  { name: "Rose", petal: "#ff7eb6", center: "#c2185b" },
  { name: "Lavender", petal: "#b18cff", center: "#ffe082" },
];
// The green zone, as a share of the player's comfortable max. Each flower
// gets its own: somewhere from light (20%) to firm (75%), about a quarter
// of the max wide, and never in the same place twice in a row.
function newZone(prev) {
  for (;;) {
    const lo = 0.2 + Math.random() * 0.25;
    const zone = [lo, lo + 0.22 + Math.random() * 0.08];
    if (!prev || Math.abs((zone[0] + zone[1]) / 2 - (prev[0] + prev[1]) / 2) > 0.1) return zone;
  }
}
const METER_TOP = 0.9; // the grip meter shows 0 .. 90% of max
const FILL_S = 3.5; // seconds of steady squeezing to fill the can
const POUR_S = 3; // seconds to empty the can at a good tilt
const POUR_START = 0.2; // tilt down this far (reach) and water starts to flow...
const POUR_FULL = 0.55; // ...this far pours at full speed
const BLOOM_S = 2; // celebrate each flower
const FINISH_DELAY = 0.3;
const TILT_SMOOTH_S = 0.15; // the can follows the hand smoothly
const CAN_MAX_DEG = 55;
// Demo: holding keeps squeezing harder, letting go eases off -- so staying in
// the green takes the same "not too hard, not too soft" control as a hand.
const DEMO_RISE = 0.3; // pretend share of max per second while held
const DEMO_FALL = 0.4; // ...and while let go
const DEMO_TILT = 2; // pretend reach per second while an arrow is held

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// ---- Scene geometry (SVG units) ----
// The can and tap are drawn 40 units higher than their own coordinates (see
// CAN_LIFT), so a full-grown flower never touches the spout.
const CAN_LIFT = 40;
const PIVOT = { x: 100, y: 165 - CAN_LIFT }; // the can tips around its handle side
const SPOUT = { x: 178, y: 118 - CAN_LIFT }; // spout tip, untilted
const POT_TOP = 292;
const STEM_X = 190;

function spoutAt(deg) {
  const a = (deg * Math.PI) / 180;
  const dx = SPOUT.x - PIVOT.x;
  const dy = SPOUT.y - PIVOT.y;
  return { x: PIVOT.x + dx * Math.cos(a) - dy * Math.sin(a), y: PIVOT.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

// Stem path for a growth level (0 = wilted sprout, 1 = full height).
function stemPath(growth) {
  const h = 34 + 100 * growth;
  const droop = (1 - growth) * 26;
  const top = { x: STEM_X + droop, y: POT_TOP - h + droop * 0.9 };
  return { d: `M ${STEM_X} ${POT_TOP} Q ${STEM_X - 6} ${POT_TOP - h * 0.55} ${top.x} ${top.y}`, top };
}

function Flower({ flower, growth, bloom, stemRef, leafRef, headRef }) {
  const { d, top } = stemPath(growth);
  const petals = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <g>
      <path ref={stemRef} d={d} className="garden-stem" />
      <g ref={leafRef} transform={`translate(${STEM_X} ${POT_TOP - 30}) scale(${0.5 + growth * 0.6})`}>
        <ellipse cx="-12" cy="0" rx="13" ry="5" transform="rotate(-25)" className="garden-leaf" />
        <ellipse cx="12" cy="-10" rx="13" ry="5" transform="rotate(25 0 -10)" className="garden-leaf" />
      </g>
      <g ref={headRef} transform={`translate(${top.x} ${top.y})`}>
        <g className={bloom ? "garden-bloom is-open" : "garden-bloom"} style={{ "--petal": flower.petal }}>
          {petals.map((r) => (
            <ellipse key={r} cx="0" cy="-15" rx="8" ry="14" transform={`rotate(${r})`} className="garden-petal" />
          ))}
        </g>
        <circle r={bloom ? 10 : 6} fill={bloom ? flower.center : "#7cc46b"} className="garden-bud" />
      </g>
    </g>
  );
}

function DemoControls({ held, stage }) {
  const press = (key, down) => (e) => {
    e.preventDefault();
    if (down) {
      held.current.add(key);
      // Keep getting this pointer's events, so letting go is always noticed.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } else {
      held.current.delete(key);
    }
  };
  const handlers = (key) => ({
    onPointerDown: press(key, true),
    onPointerUp: press(key, false),
    onPointerLeave: press(key, false),
    onPointerCancel: press(key, false),
    onContextMenu: (e) => e.preventDefault(),
  });
  const pour = stage === "pour";
  return (
    <div className="hold-wrap">
      <button className="hold-btn" {...handlers(pour ? "down" : "squeeze")}>
        {pour ? <ArrowDown size={24} aria-hidden="true" /> : <Hand size={24} aria-hidden="true" />}
        {pour ? "Hold to tilt the can" : "Hold to squeeze"}
      </button>
      <p className="game-hint">{pour ? "or hold the Down arrow" : "Hold to squeeze harder, let go to ease off (or Space)"}</p>
    </div>
  );
}

export default function Garden({
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
  const setEl = (name) => (node) => {
    el.current[name] = node;
  };

  const connected = connectionState === "connected";
  const canStart = demoMode || connected;
  const devMode = useDevMode(); // Settings: play without the baseline
  const hasBaseline = demoMode || devMode || getCalibration(false) !== null;
  const tuned = tiltTuning(getBaseline(demoMode)).tuned;

  // Demo controls: Space squeezes, Down / Up tilt the can.
  useEffect(() => {
    const map = (e) =>
      e.code === "Space" ? "squeeze"
        : ["ArrowDown", "KeyS"].includes(e.code) ? "down"
          : ["ArrowUp", "KeyW"].includes(e.code) ? "up"
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
      const pitchRange = Math.round(g.range.max - g.range.min);
      const peak = Number(g.peak.toFixed(2));
      const ttt = g.timesToZone;
      // Hold endurance counts squeezes above half of max; this gentle game may
      // never get there, so leave it out instead of recording a 0.
      const grip = g.grip.result();
      if (!grip.holdBestS) grip.holdBestS = null;
      if (!demoMode) {
        addSession({
          game: "garden",
          timestamp: Date.now(),
          durationS: Math.round(g.elapsed),
          peakForcePsi: peak,
          avgForcePsi: g.squeezeFrames ? Number((g.squeezeSum / g.squeezeFrames).toFixed(2)) : 0,
          reps: g.reps.count,
          rotationRangeDeg: pitchRange,
          pitchRangeDeg: pitchRange,
          ...grip,
          ...g.tremor.result(),
          timeToTargetS: ttt.length ? Number((ttt.reduce((a, v) => a + v, 0) / ttt.length).toFixed(2)) : null,
          ...(sessionGroupId && { groupId: sessionGroupId }),
        });
      }
      setResult({
        flowers: g.bloomed,
        timeS: Math.round(g.elapsed),
        steadyS: Number(g.zoneBest.toFixed(1)),
        peak,
        rangeDeg: pitchRange,
        saved: !demoMode && !getGuest(),
      });
      setPhase("done");
    },
    [demoMode, sessionGroupId]
  );

  // Main game loop.
  useEffect(() => {
    if (phase !== "playing") return;
    const cal = getPlayCalibration(demoMode, reading.current.forcePsi);
    const tune = tiltTuning(getBaseline(demoMode));
    const demo = { psi: cal.restPsi, pitch: 0 };
    const g = {
      index: 0,
      stage: "fill", // fill | pour | bloom
      zone: newZone(null),
      t: 0,
      water: 0, // 0..1 in the can
      growth: 0, // 0..1 for the current flower
      tilt: 0, // smoothed tilt-down reach (negative = tilted up)
      inZone: false,
      zoneSeenThisFill: false,
      zoneRun: 0, // current unbroken time in the green zone
      zoneBest: 0, // longest unbroken time in the green zone
      bloomed: 0,
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
      timesToZone: [],
      range: { min: 0, max: 0 },
    };
    let raf;
    let last = performance.now();
    let lastSignature = null;

    const readInputs = (dt) => {
      if (demoMode) {
        const h = held.current;
        const span = cal.maxPsi - cal.restPsi;
        demo.psi = h.has("squeeze")
          ? Math.min(cal.maxPsi, demo.psi + DEMO_RISE * span * dt)
          : Math.max(cal.restPsi, demo.psi - DEMO_FALL * span * dt);
        const tiltTarget = h.has("down") ? -0.7 : h.has("up") ? 0.3 : 0;
        demo.pitch += clamp(tiltTarget - demo.pitch, -DEMO_TILT * dt, DEMO_TILT * dt);
        return { psi: demo.psi, pitch: demo.pitch };
      }
      const a = toAngles(reading.current);
      const deg = angleDelta(a.pitch, center.current.pitch) * tune.pitchUpSign;
      g.range.min = Math.min(g.range.min, deg);
      g.range.max = Math.max(g.range.max, deg);
      // Wrist steadiness from each new sensor reading (not each screen frame).
      const sample = reading.current;
      if (sample !== g.lastSample) {
        const at = lastDataAtRef.current;
        if (g.lastSample) g.tremor.add(a, (at - g.lastSampleAt) / 1000);
        g.lastSample = sample;
        g.lastSampleAt = at;
      }
      return { psi: sample.forcePsi, pitch: deg >= 0 ? deg / tune.full.up : deg / tune.full.down };
    };

    const draw = (level) => {
      const e = el.current;
      const pouring = g.stage === "pour";
      const deg = pouring ? clamp(g.tilt, -0.15, 1) * CAN_MAX_DEG : 0;
      e.can?.setAttribute("transform", `rotate(${deg.toFixed(2)} ${PIVOT.x} ${PIVOT.y})`);
      if (e.water) {
        const h = 47 * g.water;
        e.water.setAttribute("y", (171 - h).toFixed(1));
        e.water.setAttribute("height", h.toFixed(1));
      }
      // Tap stream while filling; spout stream while pouring.
      const filling = g.stage === "fill" && g.inZone;
      if (e.tap) e.tap.style.opacity = filling ? 1 : 0;
      const flowing = pouring && g.tilt >= POUR_START && g.water > 0;
      if (e.stream) {
        const tip = spoutAt(deg);
        const top = stemPath(g.growth).top;
        e.stream.setAttribute("d", `M ${tip.x.toFixed(1)} ${tip.y.toFixed(1)} Q ${(tip.x + 6).toFixed(1)} ${(tip.y + 40).toFixed(1)} ${(top.x - 4).toFixed(1)} ${Math.min(top.y + 6, POT_TOP).toFixed(1)}`);
        e.stream.style.opacity = flowing ? 1 : 0;
      }
      const { d, top } = stemPath(g.growth);
      e.stem?.setAttribute("d", d);
      e.leaf?.setAttribute("transform", `translate(${STEM_X} ${POT_TOP - 30}) scale(${(0.5 + g.growth * 0.6).toFixed(3)})`);
      e.head?.setAttribute("transform", `translate(${top.x.toFixed(1)} ${top.y.toFixed(1)})`);
      if (e.gripFill) e.gripFill.style.height = `${Math.min(1, level / METER_TOP) * 100}%`;
      if (e.fillBar) e.fillBar.style.width = `${(pouring ? g.growth : g.water) * 100}%`;
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
      const level = toLevel(inp.psi, cal);
      const above = Math.max(0, inp.psi - cal.restPsi);
      g.peak = Math.max(g.peak, above);
      if (level > REP_LOW) {
        g.squeezeSum += above;
        g.squeezeFrames++;
      }
      g.reps.update(level);
      g.grip.update(level, dt);
      // Smoothed tilt down (positive) / up (negative).
      g.tilt += (-inp.pitch - g.tilt) * Math.min(1, dt / TILT_SMOOTH_S);

      g.inZone = level >= g.zone[0] && level <= g.zone[1];
      g.zoneRun = g.inZone ? g.zoneRun + dt : 0;
      g.zoneBest = Math.max(g.zoneBest, g.zoneRun);
      let hint = null;
      if (g.finishing !== null) {
        g.finishing -= dt;
        if (g.finishing <= 0) {
          finish(g);
          return;
        }
      } else if (g.stage === "fill") {
        if (g.inZone) {
          if (!g.zoneSeenThisFill) {
            g.zoneSeenThisFill = true;
            g.timesToZone.push(g.t);
          }
          g.water = Math.min(1, g.water + dt / FILL_S);
        }
        hint = level > g.zone[1] ? "lighter" : level > 0.08 && level < g.zone[0] ? "harder" : null;
        if (g.water >= 1) {
          g.stage = "pour";
          g.t = 0;
        }
      } else if (g.stage === "pour") {
        const rate = clamp((g.tilt - POUR_START) / (POUR_FULL - POUR_START), 0, 1);
        // Just past the start it trickles; more tilt pours faster.
        const flow = g.tilt >= POUR_START ? Math.max(0.25, rate) / POUR_S : 0;
        const poured = Math.min(g.water, flow * dt);
        g.water -= poured;
        g.growth = Math.min(1, g.growth + poured);
        if (g.water <= 0.001) {
          g.water = 0;
          g.growth = 1;
          g.stage = "bloom";
          g.t = 0;
          g.bloomed++;
        }
      } else if (g.stage === "bloom") {
        if (g.t >= BLOOM_S) {
          if (g.bloomed >= FLOWERS.length) {
            g.finishing = FINISH_DELAY;
          } else {
            g.index++;
            g.growth = 0;
            g.zone = newZone(g.zone);
            // Zero the tilt for the next flower: wherever the hand rests now
            // counts as level -- unless it's still tipped down to pour, which
            // would make "level" a pour.
            if (g.tilt < POUR_START) {
              if (!demoMode) center.current = toAngles(reading.current);
              demo.pitch = 0;
              g.tilt = 0;
            }
            g.stage = "fill";
            g.zoneSeenThisFill = false;
            g.t = 0;
          }
        }
      }

      draw(level);

      // Only discrete changes re-render through React.
      const signature = [g.index, g.stage, g.inZone, hint, g.bloomed].join("|");
      if (signature !== lastSignature) {
        // The on-screen Demo button changes (or hides) with the stage, so a
        // press still "held" from the last stage would never be released.
        if (demoMode && lastSignature && lastSignature.split("|")[1] !== g.stage) held.current.clear();
        lastSignature = signature;
        setView({ index: g.index, stage: g.stage, inZone: g.inZone, hint, bloomed: g.bloomed, zone: g.zone });
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
    el.current = {};
    setResult(null);
    setView(null);
    setPhase("playing");
  };

  const playing = phase === "playing" && view !== null;
  const stage = view?.stage;
  const flower = FLOWERS[Math.min(view?.index ?? 0, FLOWERS.length - 1)];
  const tip = !playing
    ? ""
    : stage === "fill"
      ? view.hint === "lighter"
        ? "A little lighter…"
        : view.hint === "harder"
          ? "A little harder…"
          : view.inZone
            ? "That's it, keep holding!"
            : "Squeeze gently and hold in the green to fill the can."
      : stage === "pour"
        ? "Now tilt your hand down to water the flower."
        : `Your ${flower.name.toLowerCase()} bloomed!`;

  return (
    <>
      <div className="game-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Leave game">
          <X size={22} aria-hidden="true" />
        </button>
        <div className="game-bar-title">
          Garden Watering
          <StepTag sessionStep={sessionStep} />
        </div>
        <div className="game-timer" aria-label="Flowers">
          <Flower2 size={16} aria-hidden="true" />
          {phase === "done" ? result?.flowers : (view?.bloomed ?? 0)} / {FLOWERS.length}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {tip}
      </p>

      <div className="garden-area">
        <svg className="garden-scene" viewBox="0 0 360 440" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <circle cx="300" cy="62" r="26" className="garden-sun" />
          <g className="garden-clouds">
            <ellipse cx="230" cy="70" rx="34" ry="12" />
            <ellipse cx="250" cy="60" rx="22" ry="14" />
            <ellipse cx="60" cy="40" rx="26" ry="9" />
          </g>
          <rect x="-200" y="330" width="760" height="140" className="garden-ground" />
          <g className="garden-grass">
            {Array.from({ length: 18 }, (_, i) => (
              <path key={i} d={`M ${i * 22 + 4} 332 l 4 -10 l 4 10`} />
            ))}
          </g>

          {/* Tap */}
          <g transform={`translate(0 ${-CAN_LIFT})`}>
            <rect x="-10" y="62" width="82" height="14" rx="4" className="garden-pipe" />
            <rect x="62" y="72" width="16" height="18" rx="3" className="garden-pipe" />
            <rect x="56" y="54" width="28" height="8" rx="4" className="garden-tap-handle" />
            <rect ref={setEl("tap")} x="66" y="90" width="8" height="42" rx="4" className="garden-tap-water" style={{ opacity: 0 }} />
          </g>

          {/* Pot + flower */}
          <path d="M 162 304 L 218 304 L 210 352 L 170 352 Z" className="garden-pot" />
          <rect x="156" y="292" width="68" height="14" rx="4" className="garden-pot-rim" />
          <ellipse cx="190" cy="294" rx="30" ry="5" className="garden-soil" />
          {playing && (
            <Flower
              key={view.index}
              flower={flower}
              growth={stage === "bloom" ? 1 : 0}
              bloom={stage === "bloom"}
              stemRef={setEl("stem")}
              leafRef={setEl("leaf")}
              headRef={setEl("head")}
            />
          )}
          {!playing && <Flower flower={FLOWERS[0]} growth={1} bloom />}

          {/* Water from the spout */}
          <path ref={setEl("stream")} className="garden-stream" style={{ opacity: 0 }} />

          {/* Watering can */}
          <g ref={setEl("can")}>
            <g transform={`translate(0 ${-CAN_LIFT})`}>
            <path d="M 72 128 C 60 104, 112 100, 118 124" className="garden-can-handle" />
            <path d="M 126 150 L 172 114 L 180 122 L 132 162 Z" className="garden-can-spout" />
            <rect x="174" y="110" width="12" height="8" rx="2" transform="rotate(-38 180 114)" className="garden-can-rose" />
            <rect x="60" y="120" width="70" height="55" rx="10" className="garden-can" />
            <clipPath id="garden-can-inside">
              <rect x="64" y="124" width="62" height="47" rx="7" />
            </clipPath>
            <rect ref={setEl("water")} x="64" y="171" width="62" height="0" clipPath="url(#garden-can-inside)" className="garden-can-water" />
            <rect x="60" y="120" width="70" height="55" rx="10" className="garden-can-shine" />
            </g>
          </g>
        </svg>

        {playing && (
          <div className={`garden-tip${stage === "bloom" ? " is-bloom" : ""}`} aria-hidden="true">
            {tip}
          </div>
        )}

        {playing && stage === "fill" && (
          <div className="squeeze-meter garden-meter" aria-hidden="true">
            <div
              className="garden-zone"
              style={{
                bottom: `${(view.zone[0] / METER_TOP) * 100}%`,
                height: `${((view.zone[1] - view.zone[0]) / METER_TOP) * 100}%`,
              }}
            />
            <div ref={setEl("gripFill")} className={`squeeze-fill${view.inZone ? " is-in-zone" : ""}`} style={{ height: 0 }} />
          </div>
        )}

        {playing && stage !== "bloom" && (
          <div className="reel-progress garden-progress" aria-hidden="true">
            <span ref={setEl("fillBar")} className={stage === "pour" ? "is-growing" : ""} />
          </div>
        )}

        {phase === "intro" && (
          <div className="game-overlay">
            <div className="overlay-card">
              <div className="overlay-icon tint-mint">
                <Sprout size={30} aria-hidden="true" />
              </div>
              <h2>Water the garden</h2>
              <ol className="steps">
                <li>
                  {demoMode
                    ? "Hold Space (or the button) to squeeze harder, let go to ease off. Keep it in the green zone to fill the can."
                    : "Squeeze and hold in the green zone to fill the can. The zone moves for each flower."}
                </li>
                <li>{demoMode ? "Hold the Down arrow" : "Tilt your hand down"} to tip the can and water the flower.</li>
                <li>Grow {FLOWERS.length} flowers. No rush: you can't lose.</li>
              </ol>
              {!hasBaseline && (
                <p className="overlay-note">First, take the 1-minute baseline assessment so the green zone matches your grip.</p>
              )}
              {hasBaseline && !demoMode && (
                <p className="overlay-note">
                  Rest your forearm on the table, hand level, then tap Start.
                  {!tuned && " Take the baseline on Home to tune the tilt to your wrist."}
                </p>
              )}
              {demoMode && <p className="overlay-note">Demo mode: this game won't be saved to your progress.</p>}
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
                <Flower2 size={30} aria-hidden="true" />
              </div>
              <h2>Your garden is in bloom!</h2>
              <div className="result-stats result-stats--3">
                <div>
                  <Flower2 size={18} aria-hidden="true" />
                  <strong>
                    {result.flowers}/{FLOWERS.length}
                  </strong>
                  <span>flowers</span>
                </div>
                <div>
                  <Trophy size={18} aria-hidden="true" />
                  <strong>{result.steadyS.toFixed(1)}s</strong>
                  <span>longest steady hold</span>
                </div>
                <div>
                  <Timer size={18} aria-hidden="true" />
                  <strong>{mmss(result.timeS)}</strong>
                  <span>time</span>
                </div>
              </div>
              <p className="overlay-note">{result.saved ? "Saved to your progress." : notSavedText(demoMode)}</p>
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
        stage !== "bloom" &&
        (demoMode ? (
          <DemoControls held={held} stage={stage} />
        ) : (
          <p className="game-hint" style={{ marginTop: 14, textAlign: "center" }}>
            {stage === "pour" ? "Tilt more to pour faster. Tilt back up to stop." : "Not too hard, not too soft: keep it in the green."}
          </p>
        ))}
    </>
  );
}
