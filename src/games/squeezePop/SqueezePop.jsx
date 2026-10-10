import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleDot, Hand, PartyPopper, Repeat, Trophy, X } from "lucide-react";
import { addSession } from "../../data/sessionStore";
import { getCalibration, saveCalibration } from "../../data/gripCalibration";
import { TARGETS, createRepCounter, stepBubble, toLevel, REP_LOW } from "./logic";
import { useDevicePause } from "../useDevicePause";
import ConnectionPause from "../ConnectionPause";
import ResultActions, { StepTag } from "../ResultActions";
import { createGripTracker, createTremorTracker, fatiguePct } from "../metrics";
import { toAngles } from "../../ble/orientation";

const TOTAL_BUBBLES = 15;
const RISE_SECONDS = 9;
const GAP_SECONDS = 0.9;
const REST_EVERY = 5; // pops between rest breaks
const REST_SECONDS = 4;
const FINISH_DELAY = 0.7; // let the last pop animation play
const RELAX_SECONDS = 2.5;
const CAL_SQUEEZE_SECONDS = 5;
const DEMO_MAX_PSI = 10;
const DEMO_RISE = 6; // pretend psi per second while the button is held
const DEMO_FALL = 32; // a real hand lets go fast, so the pretend grip drops quickly
const MIN_RANGE = { demo: 2, real: 0.5 }; // smallest squeeze the grip check accepts
const BUBBLE_SIZE = 112;

function randomTarget(prev) {
  const options = prev ? TARGETS.filter((t) => t.id !== prev.id) : TARGETS;
  return options[Math.floor(Math.random() * options.length)];
}

const RING_R = 50;
const RING_LENGTH = 2 * Math.PI * RING_R;
const bubbleBottom = (y) => `calc(${y} * (100% - ${BUBBLE_SIZE}px))`;
const ringOffset = (fill) => RING_LENGTH * (1 - fill);

// The live bubble's position and ring are also written directly every frame
// through posRef/ringRef; the values here are just the starting point.
function Bubble({ bubble, fill = 0, effect, posRef, ringRef }) {
  const r = RING_R;
  const circumference = RING_LENGTH;
  return (
    <div ref={posRef} className="bubble" style={{ left: `${bubble.x}%`, bottom: bubbleBottom(bubble.y) }}>
      <div
        className={`bubble-body tint-${bubble.target.tint}${bubble.charged ? " is-charged" : ""}${
          effect ? ` is-${effect}` : ""
        }`}
      >
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <circle cx="56" cy="56" r={r} className="bubble-track" />
          <circle
            ref={ringRef}
            cx="56"
            cy="56"
            r={r}
            className="bubble-ring"
            strokeDasharray={circumference}
            strokeDashoffset={ringOffset(effect ? 1 : fill)}
            transform="rotate(-90 56 56)"
          />
        </svg>
        <span className="bubble-label">{bubble.charged && !effect ? "Let go!" : bubble.target.label}</span>
      </div>
      {effect === "popped" && <span className="pop-plus">+1</span>}
    </div>
  );
}

const meterHeight = (level) => `${Math.min(1, level) * 100}%`;

function SqueezeMeter({ level, target, fillRef }) {
  return (
    <div className="squeeze-meter" aria-hidden="true">
      <div ref={fillRef} className="squeeze-fill" style={{ height: meterHeight(level) }} />
      {target !== undefined && <div className="squeeze-goal" style={{ bottom: `${target * 100}%` }} />}
    </div>
  );
}

// Live squeeze during the grip check, in psi above the relaxed hand. The
// scale grows with the best squeeze so the bar stays meaningful whether the
// player's grip is weak or strong; the line marks the best so far.
function CalSqueezeMeter({ nowPsi = 0, bestPsi = 0 }) {
  const scale = Math.max(4, bestPsi * 1.25);
  const pct = (v) => `${Math.min(1, v / scale) * 100}%`;
  return (
    <div className="cal-squeeze">
      <div className="cal-squeeze-head">
        <span>Your squeeze</span>
        <strong>{nowPsi.toFixed(1)} psi</strong>
      </div>
      <div
        className="cal-squeeze-track"
        role="meter"
        aria-label="Your squeeze"
        aria-valuemin={0}
        aria-valuemax={Math.round(scale)}
        aria-valuenow={Number(nowPsi.toFixed(1))}
      >
        <div className="cal-squeeze-fill" style={{ width: pct(nowPsi) }} />
        {bestPsi > 0 && <div className="cal-squeeze-best" style={{ left: pct(bestPsi) }} />}
      </div>
      <div className="cal-squeeze-best-text">Best: {bestPsi.toFixed(1)} psi</div>
    </div>
  );
}

function HoldButton({ held }) {
  const set = (down) => (e) => {
    e.preventDefault();
    held.current = down;
  };
  return (
    <div className="hold-wrap">
      <button
        className="hold-btn"
        onPointerDown={set(true)}
        onPointerUp={set(false)}
        onPointerLeave={set(false)}
        onPointerCancel={set(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Hand size={24} aria-hidden="true" /> Hold to squeeze
      </button>
      <p className="game-hint">or hold the Space bar</p>
    </div>
  );
}

export default function SqueezePop({
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
  const [phase, setPhase] = useState("intro"); // intro | calibrate | playing | done
  const [view, setView] = useState(null);
  const [result, setResult] = useState(null);
  const [calFailed, setCalFailed] = useState(null); // null | "squeeze" | "connection"
  const link = useDevicePause({
    active: phase === "playing" || phase === "calibrate",
    demoMode,
    connectionState,
    lastDataAtRef,
  });

  // A grip check interrupted by a dropped link can't be trusted: cancel it.
  if (phase === "calibrate" && link.paused) {
    setPhase("intro");
    setCalFailed("connection");
  }

  const held = useRef(false);
  const demoPsi = useRef(0);
  const meterFillRef = useRef(null);
  const bubblePosRef = useRef(null);
  const bubbleRingRef = useRef(null);

  const connected = connectionState === "connected";
  const canStart = demoMode || connected;
  const hasCalibration = getCalibration(demoMode) !== null;

  const readPsi = useCallback(
    (dt) => {
      if (!demoMode) return reading.current.forcePsi;
      const p = demoPsi.current;
      demoPsi.current = held.current
        ? Math.min(DEMO_MAX_PSI, p + DEMO_RISE * dt)
        : Math.max(0, p - DEMO_FALL * dt);
      return demoPsi.current;
    },
    [demoMode, reading]
  );

  // Space bar squeezes in demo mode. Only swallowed while a round is
  // running, so Space still works on buttons in the menus.
  useEffect(() => {
    const active = phase === "calibrate" || phase === "playing";
    const onDown = (e) => {
      if (e.code !== "Space" || !active) return;
      e.preventDefault();
      if (demoMode) held.current = true;
    };
    const onUp = (e) => {
      if (e.code === "Space") held.current = false;
    };
    const release = () => {
      held.current = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
    };
  }, [phase, demoMode]);

  // Grip check: average the relaxed reading, then record the best squeeze.
  useEffect(() => {
    if (phase !== "calibrate") return;
    let raf;
    let last = performance.now();
    const startedAt = last;
    let restSum = 0;
    let restCount = 0;
    let rest = null;
    let peak = -Infinity;
    const minRange = demoMode ? MIN_RANGE.demo : MIN_RANGE.real;

    const step = (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      const psi = readPsi(dt);
      const t = (now - startedAt) / 1000;

      if (t < RELAX_SECONDS) {
        restSum += psi;
        restCount++;
        setView({ calStep: "relax", progress: t / RELAX_SECONDS });
      } else if (t < RELAX_SECONDS + CAL_SQUEEZE_SECONDS) {
        if (rest === null) rest = restCount ? restSum / restCount : psi;
        peak = Math.max(peak, psi);
        setView({
          calStep: "squeeze",
          progress: (t - RELAX_SECONDS) / CAL_SQUEEZE_SECONDS,
          felt: peak - rest >= minRange,
          nowPsi: Math.max(0, psi - rest), // squeeze above the relaxed reading
          bestPsi: Math.max(0, peak - rest),
        });
      } else {
        if (peak - rest >= minRange) {
          saveCalibration(demoMode, { restPsi: rest, maxPsi: peak, at: Date.now() });
          setView(null);
          setPhase("playing");
        } else {
          setCalFailed("squeeze");
          setPhase("intro");
        }
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, readPsi, demoMode]);

  const finish = useCallback(
    (g) => {
      const peak = Number(g.peak.toFixed(2));
      const avg = g.squeezeFrames ? Number((g.squeezeSum / g.squeezeFrames).toFixed(2)) : 0;
      const ttt = g.timesToTarget;
      const advanced = {
        ...g.grip.result(),
        ...g.tremor.result(),
        timeToTargetS: ttt.length ? Number((ttt.reduce((a, v) => a + v, 0) / ttt.length).toFixed(2)) : null,
        fatiguePct: fatiguePct(g.popPeaks),
      };
      if (!demoMode) {
        addSession({
          game: "squeeze-pop",
          timestamp: Date.now(),
          durationS: Math.round(g.elapsed),
          peakForcePsi: peak,
          avgForcePsi: avg,
          reps: g.reps.count,
          rotationRangeDeg: null,
          ...advanced,
          ...(sessionGroupId && { groupId: sessionGroupId }),
        });
      }
      setResult({ popped: g.popped, peak, reps: g.reps.count, saved: !demoMode });
      setPhase("done");
    },
    [demoMode, sessionGroupId]
  );

  // Main game loop.
  useEffect(() => {
    if (phase !== "playing") return;
    const cal = getCalibration(demoMode);
    const g = {
      bubble: null,
      wait: 0.6,
      resolved: 0,
      popped: 0,
      sinceRest: 0,
      resting: 0,
      finishing: null,
      effects: [],
      lastTarget: null,
      elapsed: 0,
      peak: 0,
      squeezeSum: 0,
      squeezeFrames: 0,
      reps: createRepCounter(),
      // advanced measurements (Progress -> Advanced details)
      grip: createGripTracker(),
      tremor: createTremorTracker(),
      lastSample: null,
      lastSampleAt: 0,
      popPeaks: [],
      timesToTarget: [],
    };
    let raf;
    let last = performance.now();

    const step = (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (link.pausedRef.current) {
        raf = requestAnimationFrame(step); // frozen in place until Resume
        return;
      }
      g.elapsed += dt;

      const psi = readPsi(dt);
      const level = toLevel(psi, cal);
      const above = Math.max(0, psi - cal.restPsi);
      g.peak = Math.max(g.peak, above);
      if (level > REP_LOW) {
        g.squeezeSum += above;
        g.squeezeFrames++;
      }
      g.reps.update(level);
      g.grip.update(level, dt);
      if (!demoMode) {
        // Wrist steadiness from each new sensor reading (not each screen frame).
        const r = reading.current;
        if (r !== g.lastSample) {
          const at = lastDataAtRef.current;
          if (g.lastSample) g.tremor.add(toAngles(r), (at - g.lastSampleAt) / 1000);
          g.lastSample = r;
          g.lastSampleAt = at;
        }
      }
      g.effects = g.effects.filter((e) => now - e.at < 600);

      if (g.finishing !== null) {
        g.finishing -= dt;
        if (g.finishing <= 0) {
          finish(g);
          return;
        }
      } else if (g.resting > 0) {
        g.resting = Math.max(0, g.resting - dt);
      } else if (g.bubble) {
        const b = g.bubble;
        if (!b.charged && b.riseAt === undefined && level > REP_LOW) b.riseAt = g.elapsed;
        b.peak = Math.max(b.peak ?? 0, level);
        const wasCharged = b.charged;
        const outcome = stepBubble(b, level, dt, RISE_SECONDS);
        if (!wasCharged && b.charged && b.riseAt !== undefined) g.timesToTarget.push(g.elapsed - b.riseAt);
        if (outcome === "popped") g.popPeaks.push(b.peak);
        if (outcome) {
          g.effects.push({ ...g.bubble, kind: outcome, at: now });
          g.bubble = null;
          g.resolved++;
          g.wait = GAP_SECONDS;
          if (outcome === "popped") {
            g.popped++;
            g.sinceRest++;
          }
          if (g.resolved >= TOTAL_BUBBLES) {
            g.finishing = FINISH_DELAY;
          } else if (outcome === "popped" && g.sinceRest >= REST_EVERY) {
            g.sinceRest = 0;
            g.resting = REST_SECONDS;
          }
        }
      } else {
        g.wait -= dt;
        if (g.wait <= 0) {
          const target = randomTarget(g.lastTarget);
          g.lastTarget = target;
          g.bubble = { id: g.resolved, target, y: 0, x: 18 + Math.random() * 50, charged: false };
        }
      }

      // Continuous visuals: written straight to the page every frame, so the
      // bar and ring track the squeeze exactly without waiting on React.
      const fill = g.bubble ? Math.min(1, level / g.bubble.target.level) : 0;
      if (meterFillRef.current) meterFillRef.current.style.height = meterHeight(level);
      if (g.bubble && bubblePosRef.current) {
        bubblePosRef.current.style.bottom = bubbleBottom(g.bubble.y);
        bubbleRingRef.current?.setAttribute("stroke-dashoffset", ringOffset(fill));
      }

      // Discrete changes (new bubble, filled, popped, rest countdown) are the
      // only things that re-render through React -- a few times a second.
      const restSeconds = Math.ceil(g.resting);
      const signature = [
        g.bubble?.id,
        g.bubble?.charged,
        g.resolved,
        restSeconds,
        g.effects.map((e) => e.id).join(","),
      ].join("|");
      if (signature !== lastSignature) {
        lastSignature = signature;
        setView({
          level,
          fill,
          bubble: g.bubble && { ...g.bubble },
          effects: g.effects.slice(),
          resolved: g.resolved,
          restSeconds,
        });
      }
      raf = requestAnimationFrame(step);
    };
    let lastSignature = null;
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase, readPsi, demoMode, finish, link.pausedRef, reading, lastDataAtRef]);

  const begin = (forceCalibrate) => {
    held.current = false;
    demoPsi.current = 0;
    link.resume(); // clear any pause left over from an interrupted grip check
    setCalFailed(null);
    setResult(null);
    setView(null);
    setPhase(forceCalibrate || !getCalibration(demoMode) ? "calibrate" : "playing");
  };

  const playing = phase === "playing" && view?.effects !== undefined;
  const instruction = !playing
    ? ""
    : view.restSeconds > 0
      ? "Relax your hand for a moment."
      : view.bubble
        ? view.bubble.charged
          ? "Now let go to pop it."
          : `${view.bubble.target.label} bubble. Squeeze to fill the ring.`
        : "";

  return (
    <>
      <div className="game-bar">
        <button className="icon-btn" onClick={onExit} aria-label="Leave game">
          <X size={22} aria-hidden="true" />
        </button>
        <div className="game-bar-title">
          Squeeze Pop
          <StepTag sessionStep={sessionStep} />
        </div>
        <div className="game-timer" aria-label="Bubbles">
          <CircleDot size={16} aria-hidden="true" />
          {phase === "done" ? TOTAL_BUBBLES : (playing ? view.resolved : 0)} / {TOTAL_BUBBLES}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {instruction}
      </p>

      <div className="pop-area">
        <span className="pop-decor pop-decor--a" aria-hidden="true" />
        <span className="pop-decor pop-decor--b" aria-hidden="true" />

        {playing && (
          <>
            {view.effects.map((e) => (
              <Bubble key={`fx-${e.id}`} bubble={e} effect={e.kind} />
            ))}
            {view.bubble && (
              <Bubble
                key={view.bubble.id}
                bubble={view.bubble}
                fill={view.fill}
                posRef={bubblePosRef}
                ringRef={bubbleRingRef}
              />
            )}
            <SqueezeMeter level={view.level} target={view.bubble?.target.level} fillRef={meterFillRef} />
            {view.restSeconds > 0 && (
              <div className="rest-chip">
                <span>Nice work! Relax your hand…</span>
                <strong className="rest-count">{view.restSeconds}</strong>
              </div>
            )}
          </>
        )}

        {phase === "intro" && (
          <div className="game-overlay">
            <div className="overlay-card">
              <div className="overlay-icon tint-sky">
                <CircleDot size={30} aria-hidden="true" />
              </div>
              <h2>Pop the bubbles</h2>
              <ol className="steps">
                <li>{demoMode ? "Hold the button or Space bar to squeeze." : "Squeeze the grip"} until the bubble's ring fills.</li>
                <li>Then relax your hand to pop it.</li>
                <li>Pop {TOTAL_BUBBLES} bubbles. No rush: missed ones just float away.</li>
              </ol>
              {calFailed === "squeeze" && (
                <p className="overlay-note overlay-note--warn">
                  We couldn't feel a squeeze. {demoMode ? "Hold the button longer" : "Check the grip is connected"} and
                  try again.
                </p>
              )}
              {calFailed === "connection" && (
                <p className="overlay-note overlay-note--warn">
                  AquaGrip disconnected during the grip check. Reconnect and try again.
                </p>
              )}
              {!hasCalibration && canStart && (
                <p className="overlay-note">First, a quick 8-second grip check to find your comfortable range.</p>
              )}
              {demoMode && <p className="overlay-note">Demo mode: this game won't be saved to your progress.</p>}
              {!canStart && (
                <p className="overlay-note">Connect your AquaGrip first, or turn on Demo mode to try it with the keyboard.</p>
              )}
              {canStart ? (
                <>
                  <button className="btn btn-primary btn-block" onClick={() => begin(false)}>
                    Start
                  </button>
                  {hasCalibration && (
                    <button className="link-btn" style={{ marginTop: 8 }} onClick={() => begin(true)}>
                      Redo grip check
                    </button>
                  )}
                </>
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
            connecting={connectionState === "connecting"}
            readyHint="Relax your hand."
            onReconnect={onReconnect}
            onResume={link.resume}
            onEnd={onExit}
          />
        )}

        {phase === "calibrate" && view?.calStep && (
          <div className="game-overlay">
            <div className="overlay-card" aria-live="polite">
              <div className={`overlay-icon ${view.calStep === "relax" ? "tint-mint" : "tint-peach"}`}>
                <Hand size={30} aria-hidden="true" />
              </div>
              <h2>{view.calStep === "relax" ? "Relax your hand" : "Squeeze as hard as you comfortably can"}</h2>
              <p className="overlay-note">
                {view.calStep === "relax"
                  ? "Rest your hand gently on the grip."
                  : "Keep squeezing until the time runs out. It shouldn't hurt."}
              </p>
              {view.calStep === "squeeze" && <CalSqueezeMeter nowPsi={view.nowPsi} bestPsi={view.bestPsi} />}
              {view.calStep === "squeeze" && <div className="cal-label">Time</div>}
              <div className="cal-bar">
                <div className="cal-fill" style={{ width: `${Math.min(1, view.progress) * 100}%` }} />
              </div>
              {view.calStep === "squeeze" && (
                <p className={`cal-felt${view.felt ? " is-on" : ""}`}>
                  {view.felt ? (
                    <>
                      <Check size={16} strokeWidth={3} aria-hidden="true" /> Squeeze felt
                    </>
                  ) : (
                    "Waiting for your squeeze…"
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {phase === "done" && result && (
          <div className="game-overlay">
            <div className="overlay-card">
              <div className="overlay-icon tint-mint">
                <PartyPopper size={30} aria-hidden="true" />
              </div>
              <h2>{result.popped === TOTAL_BUBBLES ? "Every bubble popped!" : "Round complete!"}</h2>
              <div className="result-stats result-stats--3">
                <div>
                  <CircleDot size={18} aria-hidden="true" />
                  <strong>
                    {result.popped}/{TOTAL_BUBBLES}
                  </strong>
                  <span>popped</span>
                </div>
                <div>
                  <Trophy size={18} aria-hidden="true" />
                  <strong>{result.peak.toFixed(1)}</strong>
                  <span>best psi</span>
                </div>
                <div>
                  <Repeat size={18} aria-hidden="true" />
                  <strong>{result.reps}</strong>
                  <span>squeezes</span>
                </div>
              </div>
              <p className="overlay-note">
                {result.saved ? "Saved to your progress." : "Demo game, not saved to your progress."}
              </p>
              <ResultActions
                sessionStep={sessionStep}
                onNext={() => onNext?.(result)}
                onPlayAgain={() => begin(false)}
                onExit={onExit}
              />
            </div>
          </div>
        )}
      </div>

      {(phase === "calibrate" || phase === "playing") &&
        (demoMode ? (
          <HoldButton held={held} />
        ) : (
          <p className="game-hint" style={{ marginTop: 16, textAlign: "center" }}>
            Squeeze to fill the ring, then relax to pop.
          </p>
        ))}
    </>
  );
}
