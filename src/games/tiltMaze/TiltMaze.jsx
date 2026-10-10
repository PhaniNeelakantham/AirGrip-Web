import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Compass, PartyPopper, RotateCw, Timer, X } from "lucide-react";
import { angleDelta, toAngles } from "../../ble/orientation";
import { createTremorTracker } from "../metrics";
import { addSession } from "../../data/sessionStore";
import { useElementWidth } from "../../hooks/useElementWidth";
import { generateMaze, resolveCollisions, wallRects } from "./maze";
import { useDevicePause } from "../useDevicePause";
import ConnectionPause from "../ConnectionPause";
import ResultActions, { StepTag } from "../ResultActions";

const COLS = 6;
const ROWS = 8;
const WALL = 0.14; // wall thickness, in cells
const BALL_R = 0.26;
const MAX_SPEED = 1.6; // cells per second at full tilt
const MAX_TILT = 40; // degrees of tilt for full speed
const DEADZONE = 4; // degrees ignored so a resting hand keeps the ball still
const KEY_RAMP = 140; // degrees per second the arrow keys ease tilt in/out
const GOAL_RADIUS = 0.35;

// Which wrist motion drives which direction. Signs may need flipping once
// the team sees how the sensor is mounted on the real device.
const AXIS_MAP = {
  x: { axis: "roll", sign: 1 }, // palm turn -> left/right
  y: { axis: "pitch", sign: -1 }, // tilt up/down -> up/down
};

const KEY_DIRS = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down",
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    floor: v("--tint-sky"),
    wall: v("--primary"),
    goal: v("--tint-mint"),
    goalIcon: v("--icon-mint"),
    ballA: v("--tile-games-from"),
    ballB: v("--teal"),
  };
}

function speedFromTilt(deg) {
  const mag = Math.abs(deg);
  if (mag < DEADZONE) return 0;
  const t = Math.min(1, (mag - DEADZONE) / (MAX_TILT - DEADZONE));
  return Math.sign(deg) * t * MAX_SPEED;
}

function ArrowPad({ held }) {
  const press = (dir, down) => (e) => {
    e.preventDefault();
    if (down) held.current.add(dir);
    else held.current.delete(dir);
  };
  const btn = (dir, Icon, label, area) => (
    <button
      className="pad-btn"
      style={{ gridArea: area }}
      aria-label={label}
      onPointerDown={press(dir, true)}
      onPointerUp={press(dir, false)}
      onPointerLeave={press(dir, false)}
      onPointerCancel={press(dir, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Icon size={26} strokeWidth={2.6} aria-hidden="true" />
    </button>
  );
  return (
    <div className="pad">
      {btn("up", ArrowUp, "Tilt up", "up")}
      {btn("left", ArrowLeft, "Tilt left", "left")}
      {btn("right", ArrowRight, "Tilt right", "right")}
      {btn("down", ArrowDown, "Tilt down", "down")}
    </div>
  );
}

export default function TiltMaze({
  connectionState,
  readingRef: reading,
  lastDataAtRef,
  demoMode,
  onExit,
  onReconnect,
  sessionStep = null,
  sessionGroupId = null,
  onNext,
}) {
  const [phase, setPhase] = useState("intro"); // intro | playing | done
  const link = useDevicePause({ active: phase === "playing", demoMode, connectionState, lastDataAtRef });
  const [maze, setMaze] = useState(() => generateMaze(COLS, ROWS));
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const indicatorRef = useRef(null);
  const width = useElementWidth(wrapRef);

  const rects = useMemo(() => wallRects(maze, WALL), [maze]);

  const ball = useRef({ x: 0.5, y: 0.5, vx: 0, vy: 0 });
  const held = useRef(new Set());
  const keyTilt = useRef({ x: 0, y: 0 });
  const center = useRef({ pitch: 0, roll: 0, yaw: 0 });
  const range = useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  const tremor = useRef({ tracker: createTremorTracker(), last: null, lastAt: 0 });
  const colors = useRef(null);

  const connected = connectionState === "connected";
  const canStart = demoMode || connected;

  const cellPx = width / (COLS + WALL);
  const height = cellPx * (ROWS + WALL);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    const c = colors.current ?? (colors.current = readColors());
    const off = (WALL / 2) * cellPx;
    const px = (u) => off + u * cellPx;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = c.floor;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 18);
    ctx.fill();

    // goal: soft circle with a flag
    const gx = px(COLS - 0.5);
    const gy = px(ROWS - 0.5);
    ctx.fillStyle = c.goal;
    ctx.beginPath();
    ctx.arc(gx, gy, cellPx * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.goalIcon;
    ctx.fillStyle = c.goalIcon;
    ctx.lineWidth = Math.max(2, cellPx * 0.05);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(gx - cellPx * 0.1, gy + cellPx * 0.2);
    ctx.lineTo(gx - cellPx * 0.1, gy - cellPx * 0.22);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx - cellPx * 0.1, gy - cellPx * 0.22);
    ctx.lineTo(gx + cellPx * 0.2, gy - cellPx * 0.12);
    ctx.lineTo(gx - cellPx * 0.1, gy - cellPx * 0.02);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = c.wall;
    for (const r of rects) {
      ctx.beginPath();
      ctx.roundRect(px(r.x), px(r.y), r.w * cellPx, r.h * cellPx, (WALL * cellPx) / 2);
      ctx.fill();
    }

    const b = ball.current;
    const bx = px(b.x);
    const by = px(b.y);
    const br = BALL_R * cellPx;
    ctx.fillStyle = "rgba(20, 23, 43, 0.18)";
    ctx.beginPath();
    ctx.arc(bx + br * 0.15, by + br * 0.25, br, 0, Math.PI * 2);
    ctx.fill();
    const grad = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.35, c.ballA);
    grad.addColorStop(1, c.ballB);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }, [width, height, cellPx, rects]);

  // Static redraw for intro/results and on resize or theme change.
  useEffect(() => {
    colors.current = null;
    draw();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => {
      colors.current = null;
      draw();
    };
    mq.addEventListener("change", onTheme);
    return () => mq.removeEventListener("change", onTheme);
  }, [draw, phase]);

  // Arrow keys / WASD, demo mode only. Arrow keys are always swallowed
  // during the game so they don't scroll the page.
  useEffect(() => {
    const onDown = (e) => {
      const dir = KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!dir) return;
      e.preventDefault();
      if (demoMode) held.current.add(dir);
    };
    const onUp = (e) => {
      const dir = KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (dir) held.current.delete(dir);
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
  }, [demoMode]);

  const finish = useCallback(
    (timeS) => {
      const rg = range.current;
      const rangeDeg = Math.round(Math.max(rg.maxX - rg.minX, rg.maxY - rg.minY));
      if (!demoMode) {
        addSession({
          game: "tilt-maze",
          timestamp: Date.now(),
          durationS: timeS,
          peakForcePsi: null,
          avgForcePsi: null,
          reps: null,
          rotationRangeDeg: rangeDeg,
          // advanced: range per direction + wrist steadiness (X = palm turn, Y = tilt; see AXIS_MAP)
          rollRangeDeg: Math.round(rg.maxX - rg.minX),
          pitchRangeDeg: Math.round(rg.maxY - rg.minY),
          ...tremor.current.tracker.result(),
          ...(sessionGroupId && { groupId: sessionGroupId }),
        });
      }
      setResult({ timeS, rangeDeg, saved: !demoMode });
      setPhase("done");
    },
    [demoMode, sessionGroupId]
  );

  // Game loop.
  useEffect(() => {
    if (phase !== "playing") return;
    let raf;
    let last = performance.now();
    let seconds = 0; // time actually played: paused or off-screen time doesn't count
    let lastUi = 0;

    // Current tilt in degrees: x > 0 = right, y > 0 = down.
    const readTilt = (dt) => {
      if (demoMode) {
        const k = keyTilt.current;
        const h = held.current;
        const targetX = (h.has("right") ? MAX_TILT : 0) - (h.has("left") ? MAX_TILT : 0);
        const targetY = (h.has("down") ? MAX_TILT : 0) - (h.has("up") ? MAX_TILT : 0);
        const ramp = KEY_RAMP * dt;
        k.x += Math.max(-ramp, Math.min(ramp, targetX - k.x));
        k.y += Math.max(-ramp, Math.min(ramp, targetY - k.y));
        return { x: k.x, y: k.y };
      }
      const angles = toAngles(reading.current);
      const axis = (m) => angleDelta(angles[m.axis], center.current[m.axis]) * m.sign;
      return { x: axis(AXIS_MAP.x), y: axis(AXIS_MAP.y) };
    };

    const step = (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (link.pausedRef.current) {
        raf = requestAnimationFrame(step);
        return;
      }
      seconds += dt;

      const tilt = readTilt(dt);
      if (!demoMode) {
        // Wrist steadiness from each new sensor reading (not each screen frame).
        const tr = tremor.current;
        const r = reading.current;
        if (r !== tr.last) {
          const at = lastDataAtRef.current;
          if (tr.last) tr.tracker.add(toAngles(r), (at - tr.lastAt) / 1000);
          tr.last = r;
          tr.lastAt = at;
        }
      }
      const rg = range.current;
      rg.minX = Math.min(rg.minX, tilt.x);
      rg.maxX = Math.max(rg.maxX, tilt.x);
      rg.minY = Math.min(rg.minY, tilt.y);
      rg.maxY = Math.max(rg.maxY, tilt.y);

      const b = ball.current;
      const ease = 1 - Math.exp(-dt * 10); // smooth start/stop
      b.vx += (speedFromTilt(tilt.x) - b.vx) * ease;
      b.vy += (speedFromTilt(tilt.y) - b.vy) * ease;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      resolveCollisions(b, BALL_R, rects);
      draw();

      if (indicatorRef.current) {
        const clamp = (v) => Math.max(-1, Math.min(1, v / MAX_TILT));
        indicatorRef.current.style.transform = `translate(${clamp(tilt.x) * 22}px, ${clamp(tilt.y) * 22}px)`;
      }

      if (Math.hypot(b.x - (COLS - 0.5), b.y - (ROWS - 0.5)) < GOAL_RADIUS) {
        finish(Math.round(seconds));
        return;
      }
      if (now - lastUi > 250) {
        lastUi = now;
        setElapsed(seconds);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, demoMode, reading, lastDataAtRef, rects, draw, finish, link.pausedRef]);

  // After a reconnect the hand may have moved, so "level" is wherever it is now.
  const resumeAfterReconnect = () => {
    center.current = toAngles(reading.current);
    ball.current.vx = 0;
    ball.current.vy = 0;
    link.resume();
  };

  const start = (newMaze) => {
    if (newMaze) setMaze(generateMaze(COLS, ROWS));
    ball.current = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
    keyTilt.current = { x: 0, y: 0 };
    held.current.clear();
    range.current = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    tremor.current = { tracker: createTremorTracker(), last: null, lastAt: 0 };
    if (!demoMode) center.current = toAngles(reading.current);
    setElapsed(0);
    setResult(null);
    setPhase("playing");
  };

  return (
    <>
      <div className="game-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Leave game">
          <X size={22} aria-hidden="true" />
        </button>
        <div className="game-bar-title">
          Tilt Maze
          <StepTag sessionStep={sessionStep} />
        </div>
        <div className="game-timer" aria-label="Time">
          <Timer size={16} aria-hidden="true" /> {formatTime(phase === "done" ? result.timeS : elapsed)}
        </div>
      </div>

      <div className="maze-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ width, height }}
          role="img"
          aria-label="Maze. Roll the ball from the top left to the flag in the bottom right."
        />

        {phase === "intro" && (
          <div className="game-overlay">
            <div className="overlay-card">
              <div className="overlay-icon tint-lavender">
                <Compass size={30} aria-hidden="true" />
              </div>
              <h2>Roll the ball to the flag</h2>
              <ol className="steps">
                <li>Rest your arm and hold your hand level.</li>
                <li>{demoMode ? "Use the arrow keys or the arrows below." : "Tilt your wrist to roll the ball."}</li>
                <li>Reach the flag in the corner to finish.</li>
              </ol>
              {demoMode && <p className="overlay-note">Demo mode: this game won't be saved to your progress.</p>}
              {!canStart && (
                <p className="overlay-note">Connect your AquaGrip first, or turn on Demo mode to try it with the keyboard.</p>
              )}
              {canStart ? (
                <button className="btn btn-primary btn-block" onClick={() => start(false)}>
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

        {link.paused && (
          <ConnectionPause
            lost={link.lost}
            connecting={connectionState === "connecting"}
            readyHint="Hold your hand level."
            onReconnect={onReconnect}
            onResume={resumeAfterReconnect}
            onEnd={onExit}
          />
        )}

        {phase === "done" && result && (
          <div className="game-overlay">
            <div className="overlay-card">
              <div className="overlay-icon tint-mint">
                <PartyPopper size={30} aria-hidden="true" />
              </div>
              <h2>Maze complete!</h2>
              <div className="result-stats">
                <div>
                  <Timer size={18} aria-hidden="true" />
                  <strong>{formatTime(result.timeS)}</strong>
                  <span>time</span>
                </div>
                <div>
                  <RotateCw size={18} aria-hidden="true" />
                  <strong>{result.rangeDeg}°</strong>
                  <span>wrist range</span>
                </div>
              </div>
              <p className="overlay-note">
                {result.saved ? "Saved to your progress." : "Demo game, not saved to your progress."}
              </p>
              <ResultActions
                sessionStep={sessionStep}
                onNext={() => onNext?.(result)}
                onPlayAgain={() => start(true)}
                onExit={onExit}
                playAgainLabel="Play a new maze"
              />
            </div>
          </div>
        )}
      </div>

      {phase === "playing" && (
        <div className="game-controls">
          <div className="tilt-indicator" aria-hidden="true">
            <span ref={indicatorRef} className="tilt-dot" />
          </div>
          {demoMode ? (
            <ArrowPad held={held} />
          ) : (
            <p className="game-hint">Tilt gently. Hold still to stop the ball.</p>
          )}
        </div>
      )}
    </>
  );
}
