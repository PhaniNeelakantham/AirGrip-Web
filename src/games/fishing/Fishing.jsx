import "@fontsource/pixelify-sans/600.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Fish as FishIcon, Hand, Star, Timer, Trophy, X } from "lucide-react";
import { addSession } from "../../data/sessionStore";
import { getCalibration, getPlayCalibration } from "../../data/gripCalibration";
import { getBaseline, wristTuning } from "../../data/baseline";
import { getGuest, notSavedText, useGuest } from "../../data/guest";
import { hasCaught, recordCatch, useFishdex } from "../../data/fishdex";
import { REP_LOW, createRepCounter, toLevel } from "../squeezePop/logic";
import { createReel, toReach } from "./logic";
import { FISH, TIERS } from "./fishTypes";
import { VIEW_W, boatForTip, createWorld, drawWorld, rigAt, splash, stepWorld } from "./engine";
import { fishImageUrl } from "./sprites";
import { useDevicePause } from "../useDevicePause";
import ConnectionPause from "../ConnectionPause";
import ResultActions, { StepTag } from "../ResultActions";
import { createGripTracker, createTremorTracker } from "../metrics";
import { angleDelta, toAngles } from "../../ble/orientation";

// Side-view fishing. Wave side to side to move the boat, tilt your hand down
// to drop the hook deeper (rarer fish live deeper), squeeze when a fish
// bites (rarer = stronger, relative to your own max), then turn your wrist
// back and forth to reel it in. Two-minute round; catch as many as you can.

const ROUND_S = 120;
const BITE_WINDOW_S = 7; // squeeze within this long or the fish swims off
const ESCAPE_S = 1.2;
const LEAP_S = 0.6;
const CATCH_S = 2.4; // leap + catch card; the clock pauses
const TILT_DEADZONE = 0.12; // tilt down past this to lower the hook
const SINK_SPEED = 0.5; // depth per second at full tilt (top to bottom in ~2 s)
const REEL_UP = 0.1; // depth raised per unit of back-and-forth turning (bottom to out: ~3-4 turns)
const OUT = -0.2; // depth when the hook is lifted out of the water
const GRACE_S = 2; // after a catch or an escape, fish ignore the hook this long
const YAW_ZERO_FADE = 0.3; // how fast the "enter in the middle" offset fades (reach per second)
const SETTLED_SPEED = 0.12; // fish ignore a hook sinking or rising faster than this (depth/s)
const DEMO_MAX_PSI = 10;
const DEMO_RISE = 6;
const DEMO_FALL = 32;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mmss = (s) => {
  const total = Math.max(0, Math.ceil(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};
const tierOf = (sp) => TIERS[sp.tier];

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
  if (stage === "bite") {
    return (
      <div className="hold-wrap">
        <button className="hold-btn" {...handlers("squeeze")}>
          <Hand size={24} aria-hidden="true" /> Hold to squeeze
        </button>
        <p className="game-hint">or hold the Space bar</p>
      </div>
    );
  }
  const btn = (key, Icon, label, area) => (
    <button className="pad-btn" style={{ gridArea: area }} aria-label={label} {...handlers(key)}>
      <Icon size={24} strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
  if (stage === "reel") {
    return (
      <div className="fish-demo">
        <div className="fish-pad">{btn("up", ArrowUp, "Reel in")}</div>
        <p className="game-hint">Hold ↑ to reel (or tap ← and → in turn)</p>
      </div>
    );
  }
  return (
    <div className="fish-demo">
      <div className="pad fish-pad4">
        {btn("up", ArrowUp, "Reel the hook up", "up")}
        {btn("left", ArrowLeft, "Move the hook left", "left")}
        {btn("right", ArrowRight, "Move the hook right", "right")}
        {btn("down", ArrowDown, "Lower the hook", "down")}
      </div>
      <p className="game-hint">↓ lower · ↑ reel up · ← → move the hook</p>
    </div>
  );
}

function FishPic({ sp, size = 4, hidden = false }) {
  const s = { width: (sp.len + 8) * size, maxWidth: "100%" };
  return (
    <img
      src={fishImageUrl(sp)}
      alt=""
      className={`px-img${hidden ? " is-hidden" : ""}`}
      style={s}
      draggable="false"
    />
  );
}

function Collection({ dex, onClose }) {
  const count = FISH.filter((f) => dex[f.id]).length;
  return (
    <div className="game-overlay fishdex-overlay">
      <div className="overlay-card fishdex">
        <div className="fishdex-head">
          <h2 className="px-font">Fish collection</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close collection">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <p className="overlay-note">
          {count} of {FISH.length} found. Rarer fish swim deeper.
        </p>
        {TIERS.map((tier, z) => (
          <section key={tier.id} className="fishdex-zone">
            <h3 className="px-font" style={{ color: tier.color }}>
              {tier.zone} · {tier.label}
            </h3>
            <div className="fishdex-grid">
              {FISH.filter((f) => f.tier === z).map((f) => (
                <div key={f.id} className={`fishdex-cell${dex[f.id] ? "" : " is-unknown"}`}>
                  <FishPic sp={f} size={3} hidden={!dex[f.id]} />
                  <span>{dex[f.id] ? f.name : "???"}</span>
                  {dex[f.id] > 0 && <small>×{dex[f.id]}</small>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

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
  const [showDex, setShowDex] = useState(false);
  const link = useDevicePause({ active: phase === "playing", demoMode, connectionState, lastDataAtRef });

  const held = useRef(new Set());
  const center = useRef({ pitch: 0, roll: 0, yaw: 0 });
  const areaRef = useRef(null);
  const canvasRef = useRef(null);
  const worldRef = useRef(null);
  const [size, setSize] = useState(null); // { W, H } in art pixels
  const gripFillRef = useRef(null);
  const reelBarRef = useRef(null);

  const guest = useGuest();
  const keepsVisit = demoMode || guest;
  const dex = useFishdex(keepsVisit);
  const found = FISH.filter((f) => dex[f.id]).length;

  const connected = connectionState === "connected";
  const canStart = demoMode || connected;
  const baseline = getBaseline(demoMode);
  // Demo mode plays with default ranges; the baseline is optional there.
  const hasBaseline = demoMode || (baseline !== null && getCalibration(false) !== null);

  // The canvas is VIEW_W art pixels wide and as tall as the screen allows;
  // CSS scales it up with crisp pixels.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const H = Math.round((VIEW_W * height) / width);
      setSize((prev) => (prev && Math.abs(prev.H - H) < 2 ? prev : { W: VIEW_W, H }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!size) return;
    const c = canvasRef.current;
    c.width = size.W;
    c.height = size.H;
    worldRef.current = createWorld(size.W, size.H);
  }, [size]);

  // Behind the start and results cards, the lake just lives.
  useEffect(() => {
    if (phase === "playing" || !size) return;
    let raf;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      const world = worldRef.current;
      const ctx = canvasRef.current?.getContext("2d");
      if (world && ctx) {
        stepWorld(world, dt, { x: -999, y: -999 }, false);
        const boatX = boatForTip(world.L.W * 0.55);
        const tip = rigAt(world, boatX).tip;
        drawWorld(ctx, world, { boatX, hook: { x: tip.x, y: tip.y + 9 } });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, size]);

  // Demo controls: arrow keys / WASD, Space squeezes.
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
          fishCaught: g.caught.length,
          fishScore: g.score,
          deepestZone: g.caught.length ? Math.max(...g.caught.map((sp) => sp.tier)) : null,
          ...(sessionGroupId && { groupId: sessionGroupId }),
        });
      }
      const best = g.caught.reduce((b, sp) => (!b || sp.tier > b.tier ? sp : b), null);
      setResult({
        caught: g.caught.length,
        score: g.score,
        best,
        newCount: g.newIds.size,
        timeS: Math.round(g.elapsed),
        peak,
        rangeDeg,
        saved: !demoMode && !getGuest(),
      });
      setPhase("done");
    },
    [demoMode, sessionGroupId]
  );

  // Main game loop.
  useEffect(() => {
    if (phase !== "playing" || !size) return;
    const cal = getPlayCalibration(demoMode);
    const tune = wristTuning(getBaseline(demoMode));
    const persist = !demoMode && !getGuest();
    const world = createWorld(size.W, size.H);
    worldRef.current = world;
    const { L } = world;
    const boatX = boatForTip(L.W / 2); // the boat stays put, rod tip over the middle; the hook moves
    const demo = { psi: 0, yaw: 0, pitch: 0, roll: 0 };
    const g = {
      stage: "fish", // fish | bite | reel | escape | caught
      t: 0,
      timeLeft: ROUND_S,
      depth: OUT, // start with the hook out of the water
      hookX: null,
      lastFreeTravel: 0,
      yawZero: 0,
      wasOut: true,
      grace: 0,
      depthSpeed: 0,
      active: null,
      biteT: 0,
      hookHold: 0,
      hookReached: false,
      warn: false,
      reel: createReel(),
      lastTravel: 0,
      progress: 0,
      reelFromY: 0,
      flying: null,
      lastCatch: null,
      caught: [],
      newIds: new Set(),
      score: 0,
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
      range: { pitch: { min: 0, max: 0 }, roll: { min: 0, max: 0 }, yaw: { min: 0, max: 0 } },
    };
    let raf;
    let last = performance.now();
    let lastSignature = null;
    const ctx = canvasRef.current.getContext("2d");
    if (import.meta.env.DEV) window.__fishing = { g, world }; // for testing in the browser

    const readInputs = (dt) => {
      if (demoMode) {
        const h = held.current;
        const side = (h.has("right") ? 1 : 0) - (h.has("left") ? 1 : 0);
        const ease = (v, target, rate) => v + clamp(target - v, -rate * dt, rate * dt);
        demo.psi = h.has("squeeze")
          ? Math.min(DEMO_MAX_PSI, demo.psi + DEMO_RISE * dt)
          : Math.max(0, demo.psi - DEMO_FALL * dt);
        // Left/right move the hook, Down tilts down (lowers it), Up turns the
        // wrist back and forth (reels). While a fish is on, left/right reel too.
        // While the hook is out of the water the pretend wave returns to center,
        // so it always has the full range left and right once back in.
        if (g.wasOut) demo.yaw = 0;
        else if (g.stage === "fish" || g.stage === "escape") demo.yaw = clamp(demo.yaw + side * 1.1 * dt, -1, 1);
        demo.pitch = ease(demo.pitch, h.has("down") ? -1 : 0, 3);
        if (h.has("up")) demo.roll = Math.sin(g.elapsed * 9) * 0.8;
        else demo.roll = ease(demo.roll, g.stage === "reel" ? side * 0.8 : 0, 2.5);
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
      const travel = g.reel.update(inp.roll, dt);

      const rig = rigAt(world, boatX);
      if (g.hookX === null) g.hookX = rig.tip.x;

      // Steering: tilting down lowers the hook (further = faster), turning
      // the wrist back and forth reels it up (all the way out of the water to
      // rest), and waving side to side moves it left and right.
      const free = g.stage === "fish" || g.stage === "escape";
      if (free) {
        const before = g.depth;
        const sink = clamp((-inp.pitch - TILT_DEADZONE) / (1 - TILT_DEADZONE), 0, 1);
        g.depth += sink * SINK_SPEED * dt;
        g.depth -= (travel - g.lastFreeTravel) * REEL_UP;
        g.depth = clamp(g.depth, OUT, 1);
        // How fast the hook is moving up or down (smoothed): fish only bite a
        // settled hook, so you can drop straight past the shallows.
        const speed = dt > 0 ? Math.abs(g.depth - before) / dt : 0;
        g.depthSpeed += (speed - g.depthSpeed) * Math.min(1, dt * 6);
      }
      g.lastFreeTravel = travel;
      // While a fish is reeled in, the hook (and the fish on it) rises to the
      // surface. Above depth 0 the hook is being lifted out of the water.
      const hookY =
        g.stage === "reel"
          ? g.reelFromY + (L.surfaceY + 2 - g.reelFromY) * Math.min(1, g.progress)
          : g.depth >= 0
            ? L.depthY(g.depth)
            : L.depthY(0) + (rig.tip.y + 9 - L.depthY(0)) * (g.depth / OUT);
      const inWater = clamp((hookY - L.surfaceY) / 6, 0, 1);
      // Each time the hook goes back in, it enters in the middle: side to
      // side is measured from where the hand is at that moment (which also
      // cancels any slow drift of the sensor's yaw).
      const isOut = hookY <= L.surfaceY + 2;
      if (g.wasOut && !isOut) g.yawZero = inp.yaw;
      g.wasOut = isOut;
      // ...then that offset fades over a few seconds, so if the hand was
      // turned when the hook went in, the far side never stays out of reach.
      if (!isOut) g.yawZero -= clamp(g.yawZero, -YAW_ZERO_FADE * dt, YAW_ZERO_FADE * dt);
      if (free) {
        // Out of the water the hook hangs from the rod tip.
        const aimX = L.W / 2 + clamp(inp.yaw - g.yawZero, -1, 1) * (L.W / 2 - 6);
        const targetX = rig.tip.x + (aimX - rig.tip.x) * inWater;
        g.hookX += (targetX - g.hookX) * Math.min(1, dt * 4);
      }
      const hook = { x: g.hookX, y: hookY };
      g.grace = Math.max(0, g.grace - dt);
      const out = isOut;

      const settled = g.depthSpeed < SETTLED_SPEED;
      const bit = stepWorld(world, dt, hook, g.stage === "fish" && !out && g.grace <= 0 && settled);

      if (g.stage === "fish" && bit) {
        bit.state = "hooked";
        world.curious = null;
        g.active = bit;
        g.stage = "bite";
        g.biteT = 0;
        g.hookHold = 0;
        g.hookReached = false;
        // The hook stays where the fish took it.
        g.depth = L.depthOfY(bit.y);
      } else if (g.stage === "bite") {
        const tier = tierOf(g.active.sp);
        g.biteT += dt;
        const strong = level >= tier.grip;
        if (strong && !g.hookReached) {
          g.hookReached = true;
          g.timesToTarget.push(g.biteT);
        }
        g.warn = !strong && level > 0.08;
        g.hookHold = strong ? g.hookHold + dt : Math.max(0, g.hookHold - dt * 0.5);
        if (g.hookHold >= tier.hold) {
          g.stage = "reel";
          g.progress = 0;
          g.lastTravel = travel;
          g.reelFromY = L.depthY(g.depth);
          splash(world, hook.x, false);
        } else if (g.biteT >= BITE_WINDOW_S) {
          const f = g.active;
          f.state = "flee";
          f.dir = -f.dir;
          g.active = null;
          g.stage = "escape";
          g.t = 0;
          g.grace = GRACE_S;
        }
      } else if (g.stage === "reel") {
        const tier = tierOf(g.active.sp);
        g.progress += (travel - g.lastTravel) / tier.reel;
        g.lastTravel = travel;
        g.progress = Math.max(0, g.progress - dt * 0.04 * g.active.sp.tier); // big fish pull back a little
        if (Math.random() < dt * 4) world.bubbles.push({ x: hook.x, y: hook.y - 2, seed: Math.random() * 6 });
        if (g.progress >= 1) {
          const sp = g.active.sp;
          const isNew = !hasCaught(sp.id, !persist);
          recordCatch(sp.id, persist);
          if (isNew) g.newIds.add(sp.id);
          g.caught.push(sp);
          g.score += tier.points;
          world.fishes = world.fishes.filter((f) => f !== g.active);
          g.flying = { f: g.active, u: 0, from: { x: hook.x, y: L.surfaceY } };
          g.lastCatch = { sp, points: tier.points, isNew, n: g.caught.length };
          g.active = null;
          g.stage = "caught";
          g.t = 0;
          // The hook comes out with the fish; drop it back in when ready.
          g.depth = OUT;
          g.hookX = rig.tip.x;
          g.grace = GRACE_S;
          splash(world, hook.x, true);
        }
      } else if (g.stage === "escape") {
        if (g.t >= ESCAPE_S) g.stage = "fish";
      } else if (g.stage === "caught") {
        if (g.flying) {
          g.flying.u = Math.min(1, g.t / LEAP_S);
          if (g.flying.u >= 1) g.flying = null;
        }
        if (g.t >= CATCH_S) g.stage = "fish";
      }

      // The clock runs except while a catch is celebrated. When it runs out,
      // a fish already on the line can still be landed.
      if (g.stage !== "caught") g.timeLeft = Math.max(0, g.timeLeft - dt);
      if (g.timeLeft <= 0 && (g.stage === "fish" || g.stage === "escape")) {
        finish(g);
        return;
      }

      const tier = g.active ? tierOf(g.active.sp) : null;
      drawWorld(ctx, world, {
        boatX,
        hook: g.stage === "caught" ? null : hook,
        active: g.active,
        ring: g.stage === "bite" ? { progress: g.hookHold / tier.hold, color: tier.color, warn: g.warn } : null,
        flying: g.flying,
      });

      if (gripFillRef.current) gripFillRef.current.style.height = `${Math.min(1, level) * 100}%`;
      if (reelBarRef.current) reelBarRef.current.style.width = `${Math.min(1, g.progress) * 100}%`;

      const zone = L.zoneOfY(hookY);
      const signature = [g.stage, g.score, Math.ceil(g.timeLeft), zone, out, g.warn, g.caught.length, tier?.id].join("|");
      if (signature !== lastSignature) {
        lastSignature = signature;
        setView({
          stage: g.stage,
          score: g.score,
          timeLeft: g.timeLeft,
          zone,
          out,
          tier,
          warn: g.warn,
          lastCatch: g.lastCatch,
          caught: g.caught.length,
          lastCall: g.timeLeft <= 0,
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, size, demoMode, reading, lastDataAtRef, finish, link.pausedRef]);

  const recenter = () => {
    if (!demoMode) center.current = toAngles(reading.current);
  };

  const begin = () => {
    if (!hasBaseline) return; // the start card offers the baseline instead
    held.current.clear();
    recenter();
    link.resume();
    setShowDex(false);
    setResult(null);
    setView(null);
    setPhase("playing");
  };

  const playing = phase === "playing" && view !== null;
  const stage = view?.stage;
  const zoneTier = view ? TIERS[view.zone] : TIERS[0];
  const tip = !playing
    ? ""
    : stage === "bite"
      ? view.warn
        ? "Squeeze harder!"
        : "A bite! Squeeze and hold!"
      : stage === "reel"
        ? "Turn your wrist back and forth to reel!"
        : stage === "escape"
          ? "It got away! Try again."
          : stage === "caught"
            ? ""
            : view.out
              ? "Tilt your hand down to drop the hook in."
              : "Wave to move the hook · turn your wrist to reel up";

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
        <div className="game-timer" aria-label="Time left">
          <Timer size={16} aria-hidden="true" />
          {phase === "playing" && view ? mmss(view.timeLeft) : mmss(ROUND_S)}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {view?.lastCatch && stage === "caught" ? `You caught a ${view.lastCatch.sp.name}!` : tip}
      </p>

      <div className="fish2-area" ref={areaRef}>
        <canvas ref={canvasRef} className="fish2-canvas" aria-hidden="true" />

        {playing && (
          <>
            <div className="fish-hud px-font" aria-hidden="true">
              <span className="fish-chip">
                <Star size={14} aria-hidden="true" /> {view.score}
              </span>
              {view.out ? (
                <span className="fish-chip">Hook out of water</span>
              ) : (
                <span className="fish-chip">
                  <span className="fish-zone-dot" style={{ background: zoneTier.color }} />
                  {zoneTier.zone}
                  <em style={{ color: zoneTier.color }}>{zoneTier.label}</em>
                </span>
              )}
            </div>

            {stage === "bite" && (
              <div className="squeeze-meter fish2-meter" aria-hidden="true">
                <div ref={gripFillRef} className="squeeze-fill" style={{ height: 0 }} />
                <div className="squeeze-goal" style={{ bottom: `${view.tier.grip * 100}%`, background: view.tier.color }} />
              </div>
            )}

            {stage === "reel" && (
              <div className="reel-progress fish2-reel" aria-hidden="true">
                <span ref={reelBarRef} />
              </div>
            )}

            {stage === "caught" && view.lastCatch && (
              <div className="catch2-card" role="status" style={{ "--tier": tierOf(view.lastCatch.sp).color }}>
                {view.lastCatch.isNew && <span className="catch2-new px-font">NEW!</span>}
                <FishPic sp={view.lastCatch.sp} size={5} />
                <strong className="px-font">{view.lastCatch.sp.name}</strong>
                <span className="catch2-tier px-font">{tierOf(view.lastCatch.sp).label}</span>
                <span className="catch2-points px-font">+{view.lastCatch.points}</span>
              </div>
            )}
          </>
        )}

        {phase === "intro" && !showDex && (
          <div className="game-overlay">
            <div className="overlay-card fish2-card">
              <h2 className="px-font fish2-title">Deep Sea Fishing</h2>
              <ol className="steps">
                <li>Tilt your hand down to lower the hook. Rarer fish swim deeper.</li>
                <li>Wave your hand left or right to move the hook.</li>
                <li>Turn your wrist back and forth to reel the hook up, even out of the water to rest.</li>
                <li>When a fish bites, squeeze! Rarer fish need a stronger squeeze. Then reel it in.</li>
              </ol>
              <button className="fish-dex-btn" onClick={() => setShowDex(true)}>
                <BookOpen size={16} aria-hidden="true" /> Collection {found}/{FISH.length}
              </button>
              {!hasBaseline && (
                <p className="overlay-note">First, take the 1-minute baseline assessment so every move matches your range.</p>
              )}
              {hasBaseline && !demoMode && (
                <p className="overlay-note">Rest your forearm on the table, hand level, then tap Start. 2-minute round.</p>
              )}
              {demoMode && (
                <p className="overlay-note">Demo mode: ↓ lowers, ↑ reels up, ← → move, Space squeezes. Not saved to your progress.</p>
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

        {showDex && <Collection dex={dex} onClose={() => setShowDex(false)} />}

        {phase === "playing" && link.paused && (
          <ConnectionPause
            lost={link.lost}
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

        {phase === "done" && result && !showDex && (
          <div className="game-overlay">
            <div className="overlay-card fish2-card">
              <h2 className="px-font fish2-title">Time's up!</h2>
              <div className="result-stats result-stats--3">
                <div>
                  <FishIcon size={18} aria-hidden="true" />
                  <strong>{result.caught}</strong>
                  <span>fish</span>
                </div>
                <div>
                  <Star size={18} aria-hidden="true" />
                  <strong>{result.score}</strong>
                  <span>points</span>
                </div>
                <div>
                  <Trophy size={18} aria-hidden="true" />
                  <strong>{result.peak.toFixed(1)}</strong>
                  <span>best psi</span>
                </div>
              </div>
              {result.best && (
                <div className="fish2-best" style={{ "--tier": tierOf(result.best).color }}>
                  <FishPic sp={result.best} size={3} />
                  <span>
                    Best catch: <strong>{result.best.name}</strong>{" "}
                    <em className="px-font">{tierOf(result.best).label}</em>
                  </span>
                </div>
              )}
              <button className="fish-dex-btn" onClick={() => setShowDex(true)}>
                <BookOpen size={16} aria-hidden="true" /> Collection {found}/{FISH.length}
                {result.newCount > 0 && <span className="fish-dex-new">+{result.newCount} new</span>}
              </button>
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

      {playing && (
        <div className={`fish2-tip px-font${stage === "bite" ? " is-alert" : ""}`} aria-hidden="true">
          {stage === "caught" && view.lastCatch
            ? `You caught a ${view.lastCatch.sp.name}!`
            : `${view.lastCall && stage !== "fish" ? "Last fish! " : ""}${tip}`}
        </div>
      )}
      {playing && stage !== "caught" && demoMode && <DemoControls held={held} stage={stage} />}
    </>
  );
}
