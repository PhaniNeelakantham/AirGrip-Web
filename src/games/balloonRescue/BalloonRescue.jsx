import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Hand, Heart, PartyPopper, RotateCw, Rocket, Timer, Trophy, X } from "lucide-react";
import { angleDelta, toAngles } from "../../ble/orientation";
import { addSession } from "../../data/sessionStore";
import { getGuest, notSavedText } from "../../data/guest";
import { useDevMode } from "../../data/devMode";
import { getCalibration } from "../../data/gripCalibration";
import { REP_HIGH, createRepCounter, toLevel } from "../squeezePop/logic";
import ResultActions, { StepTag } from "../ResultActions";
import {
    BALLOON_R,
    BALLOON_Y,
    FLY_SECONDS,
    HIT_GRACE,
    LIVES,
    PUMP_DECAY,
    PUMP_GAIN,
    PUMP_SECONDS,
    createAsteroid,
    hitsBalloon,
    spawnDelay,
    stepAsteroid,
} from "./logic";

const MOVE_SPEED = 0.85; // balloon widths per second at full tilt
const MAX_TILT = 30; // degrees of wrist rotation for full speed
const DEADZONE = 4;
const KEY_RAMP = 140; // degrees per second the arrow keys ease tilt in/out
const FALLBACK_SPAN_PSI = 0.8; // squeeze range used when no grip check has been done
const BALLOON_COLOR = ["#ff8a6b", "#e8456b"];

const KEY_DIRS = { ArrowLeft: "left", ArrowRight: "right", a: "left", d: "right" };
const keyDir = (e) => KEY_DIRS[e.key.length === 1 ? e.key.toLowerCase() : e.key];

const STARS = Array.from({ length: 70 }, (_, i) => ({
    x: (i * 0.6180339) % 1,
    y: (i * 0.7548776) % 1,
    r: 0.4 + ((i * 37) % 10) / 10,
    speed: 0.01 + ((i * 13) % 10) / 160,
}));

const formatSeconds = (s) => `${Math.max(0, Math.ceil(s))}s`;

function drawAsteroid(ctx, a, w, h) {
    const r = a.r * w;
    ctx.save();
    ctx.translate(a.x * w, a.y * h);
    ctx.rotate(a.angle);
    ctx.beginPath();
    const points = 9;
    for (let i = 0; i < points; i++) {
        const ang = (i / points) * Math.PI * 2;
        const wobble = 0.78 + 0.22 * Math.sin(a.seed * 40 + i * 2.3);
        const px = Math.cos(ang) * r * wobble;
        const py = Math.sin(ang) * r * wobble;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#b9bcd1");
    g.addColorStop(1, "#4a4f6e");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = "rgba(20, 23, 43, 0.28)";
    ctx.beginPath();
    ctx.arc(r * 0.25, r * 0.15, r * 0.2, 0, Math.PI * 2);
    ctx.arc(-r * 0.35, r * 0.3, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawBalloon(ctx, cx, cy, size, { blink = false, wobble = 0 } = {}) {
    if (size <= 0) return;
    ctx.save();
    ctx.globalAlpha = blink ? 0.45 : 1;
    ctx.translate(cx, cy);
    ctx.rotate(wobble);
    const rx = size * 0.82;
    const ry = size;
    // string
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.beginPath();
    ctx.moveTo(0, ry);
    ctx.quadraticCurveTo(size * 0.25, ry + size * 0.6, -size * 0.1, ry + size * 1.2);
    ctx.stroke();
    // body
    const g = ctx.createRadialGradient(-rx * 0.35, -ry * 0.4, size * 0.1, 0, 0, ry * 1.05);
    g.addColorStop(0, "#ffd3c4");
    g.addColorStop(0.35, BALLOON_COLOR[0]);
    g.addColorStop(1, BALLOON_COLOR[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // knot
    ctx.fillStyle = BALLOON_COLOR[1];
    ctx.beginPath();
    ctx.moveTo(0, ry - 1);
    ctx.lineTo(-size * 0.12, ry + size * 0.16);
    ctx.lineTo(size * 0.12, ry + size * 0.16);
    ctx.closePath();
    ctx.fill();
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(-rx * 0.4, -ry * 0.42, rx * 0.14, ry * 0.24, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function SidePad({ held }) {
    const press = (dir, down) => (e) => {
        e.preventDefault();
        if (down) held.current.add(dir);
        else held.current.delete(dir);
    };
    const btn = (dir, Icon, label) => (
        <button
            className="pad-btn balloon-pad-btn"
            aria-label={label}
            onPointerDown={press(dir, true)}
            onPointerUp={press(dir, false)}
            onPointerLeave={press(dir, false)}
            onPointerCancel={press(dir, false)}
            onContextMenu={(e) => e.preventDefault()}
        >
            <Icon size={28} strokeWidth={2.6} aria-hidden="true" />
        </button>
    );
    return (
        <div className="balloon-pad">
            {btn("left", ArrowLeft, "Rotate left")}
            {btn("right", ArrowRight, "Rotate right")}
        </div>
    );
}

export default function BalloonRescue({
    connectionState,
    readingRef: reading,
    demoMode,
    onExit,
    onReconnect,
    onOpenBaseline,
    sessionStep = null,
    sessionGroupId = null,
    onNext,
}) {
    const [phase, setPhase] = useState("intro"); // intro | pump | fly | done
    const [hud, setHud] = useState({ seconds: PUMP_SECONDS, lives: LIVES });
    const [result, setResult] = useState(null);

    const areaRef = useRef(null);
    const canvasRef = useRef(null);
    const meterFillRef = useRef(null);
    const sizeRef = useRef({ w: 0, h: 0 });
    const [size, setSize] = useState({ w: 0, h: 0 });

    const pendingPumps = useRef(0);
    const held = useRef(new Set());
    const keyTilt = useRef(0);
    const center = useRef({ pitch: 0, roll: 0, yaw: 0 });
    const stats = useRef(null);

    const connected = connectionState === "connected";
    const canStart = demoMode || connected;
    // The pump strength comes from the Baseline assessment (optional in Demo mode).
    const devMode = useDevMode(); // Settings: play without the baseline
    const hasCalibration = demoMode || devMode || getCalibration(false) !== null;

    // Keep the canvas matched to its container.
    useEffect(() => {
        const el = areaRef.current;
        if (!el) return;
        const update = () => {
            const { width, height } = el.getBoundingClientRect();
            sizeRef.current = { w: width, h: height };
            setSize({ w: width, h: height });
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const prepareCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const { w, h } = sizeRef.current;
        if (!canvas || w === 0) return null;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return ctx;
    }, []);

    const drawStars = useCallback((ctx, w, h, t) => {
        ctx.fillStyle = "#ffffff";
        for (const s of STARS) {
            const y = (((s.y + t * s.speed) % 1) + 1) % 1;
            ctx.globalAlpha = 0.35 + s.r * 0.35;
            ctx.beginPath();
            ctx.arc(s.x * w, y * h, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }, []);

    // Idle scene behind the intro and results cards.
    useEffect(() => {
        if (phase === "pump" || phase === "fly") return;
        const ctx = prepareCanvas();
        if (!ctx) return;
        const { w, h } = sizeRef.current;
        drawStars(ctx, w, h, 0);
        if (result?.outcome === "won" || phase === "intro") {
            drawBalloon(ctx, w / 2, h * 0.5, w * BALLOON_R * 1.9);
        }
    }, [phase, result, size, prepareCanvas, drawStars]);

    // Space bar pumps (demo mode), arrows rotate. Keys are swallowed only while
    // a round is running, so they still work on buttons in menus.
    useEffect(() => {
        const onDown = (e) => {
            if (phase === "pump" && e.code === "Space") {
                e.preventDefault();
                if (demoMode && !e.repeat) pendingPumps.current++;
                return;
            }
            if (phase === "fly") {
                const dir = keyDir(e);
                if (!dir) return;
                e.preventDefault();
                if (demoMode) held.current.add(dir);
            }
        };
        const onUp = (e) => {
            const dir = keyDir(e);
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
    }, [phase, demoMode]);

    const finish = useCallback(
        (outcome, flownS) => {
            const s = stats.current;
            const rg = s.range;
            const rangeDeg = Math.round(rg.max - rg.min);
            const peak = Number(s.peak.toFixed(2));
            const avg = s.pumpFrames ? Number((s.pumpSum / s.pumpFrames).toFixed(2)) : 0;
            const hasFlight = flownS > 0;
            if (!demoMode && outcome !== "deflated") {
                addSession({
                    game: "balloon-rescue",
                    timestamp: Date.now(),
                    durationS: Math.round(s.pumpTime + flownS),
                    peakForcePsi: peak,
                    avgForcePsi: avg,
                    reps: s.pumps,
                    rotationRangeDeg: hasFlight ? rangeDeg : null,
                    ...(sessionGroupId && { groupId: sessionGroupId }),
                });
            }
            setResult({
                outcome,
                pumps: s.pumps,
                pumpTime: s.pumpTime,
                flownS,
                dodged: s.dodged,
                hits: s.hits,
                rangeDeg,
                saved: !demoMode && !getGuest() && outcome !== "deflated",
            });
            setPhase("done");
        },
        [demoMode, sessionGroupId]
    );

    // Stage 1: pump the balloon to the brim before time runs out.
    useEffect(() => {
        if (phase !== "pump") return;
        const cal = getCalibration(demoMode);
        const rest = demoMode ? 0 : reading.current.forcePsi;
        const span = cal
            ? { restPsi: cal.restPsi, maxPsi: cal.restPsi + (cal.maxPsi - cal.restPsi) * 0.5 }
            : { restPsi: rest, maxPsi: rest + FALLBACK_SPAN_PSI }; const reps = createRepCounter(0.08, 0.04);
        let repsSeen = 0;
        let fill = 0;
        let elapsed = 0;
        let lastSecond = -1;
        let raf;
        let last = performance.now();

        const step = (now) => {
            const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
            last = now;
            elapsed += dt;
            const s = stats.current;

            let pumps = pendingPumps.current;
            pendingPumps.current = 0;
            if (!demoMode) {
                const psi = reading.current.forcePsi;
                const above = Math.max(0, psi - span.restPsi);
                s.peak = Math.max(s.peak, above);
                const level = toLevel(psi, span);
                if (level > REP_HIGH) {
                    s.pumpSum += above;
                    s.pumpFrames++;
                }
                const count = reps.update(level);
                pumps += count - repsSeen;
                repsSeen = count;
            }
            s.pumps += pumps;
            fill = Math.min(1, Math.max(0, fill + pumps * PUMP_GAIN - PUMP_DECAY * dt));

            if (meterFillRef.current) meterFillRef.current.style.height = `${fill * 100}%`;

            const ctx = prepareCanvas();
            if (ctx) {
                const { w, h } = sizeRef.current;
                drawStars(ctx, w, h, elapsed);
                const full = w * BALLOON_R * 1.9;
                const balloonSize = full * (0.28 + 0.72 * fill);
                const squash = Math.sin(now / 60) * 0.02 * (pumps ? 1 : 0.3);
                drawBalloon(ctx, w / 2, h * 0.52, balloonSize, { wobble: squash });
            }

            if (fill >= 1) {
                s.pumpTime = elapsed;
                setPhase("fly");
                return;
            }
            if (elapsed >= PUMP_SECONDS) {
                s.pumpTime = PUMP_SECONDS;
                finish("deflated", 0);
                return;
            }
            const sec = Math.ceil(PUMP_SECONDS - elapsed);
            if (sec !== lastSecond) {
                lastSecond = sec;
                setHud((hd) => ({ ...hd, seconds: PUMP_SECONDS - elapsed }));
            }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [phase, demoMode, reading, prepareCanvas, drawStars, finish]);

    // Stage 2: rotate the wrist to steer the balloon clear of asteroids.
    useEffect(() => {
        if (phase !== "fly") return;
        if (!demoMode) center.current = toAngles(reading.current);
        keyTilt.current = 0;
        held.current.clear();

        const g = {
            x: 0.5,
            vx: 0,
            lives: LIVES,
            grace: 0,
            asteroids: [],
            nextId: 0,
            spawnIn: 0.8,
            elapsed: 0,
        };
        const s = stats.current;
        let lastLives = LIVES;
        let lastSecond = -1;
        let raf;
        let last = performance.now();

        const readTilt = (dt) => {
            if (demoMode) {
                const target = (held.current.has("right") ? MAX_TILT : 0) - (held.current.has("left") ? MAX_TILT : 0);
                const step = KEY_RAMP * dt;
                keyTilt.current += Math.max(-step, Math.min(step, target - keyTilt.current));
                return keyTilt.current;
            }
            return angleDelta(toAngles(reading.current).roll, center.current.roll);
        };

        const step = (now) => {
            const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
            last = now;
            g.elapsed += dt;
            const { w, h } = sizeRef.current;
            const progress = Math.min(1, g.elapsed / FLY_SECONDS);

            const tilt = readTilt(dt);
            s.range.min = Math.min(s.range.min, tilt);
            s.range.max = Math.max(s.range.max, tilt);

            const mag = Math.abs(tilt);
            const target = mag < DEADZONE ? 0 : Math.sign(tilt) * Math.min(1, (mag - DEADZONE) / (MAX_TILT - DEADZONE)) * MOVE_SPEED;
            g.vx += (target - g.vx) * (1 - Math.exp(-dt * 10));
            g.x = Math.min(0.94, Math.max(0.06, g.x + g.vx * dt));

            g.spawnIn -= dt;
            if (g.spawnIn <= 0) {
                g.asteroids.push(createAsteroid(g.nextId++, progress));
                g.spawnIn = spawnDelay(progress);
            }
            g.grace = Math.max(0, g.grace - dt);

            g.asteroids = g.asteroids.filter((a) => {
                const gone = stepAsteroid(a, dt);
                if (!a.passed && a.y > BALLOON_Y + 0.1) {
                    a.passed = true;
                    if (!a.hit) s.dodged++;
                }
                if (!gone && !a.hit && g.grace === 0 && w > 0 && hitsBalloon(a, g.x, w, h)) {
                    a.hit = true;
                    g.lives--;
                    s.hits++;
                    g.grace = HIT_GRACE;
                }
                return !gone;
            });

            const ctx = prepareCanvas();
            if (ctx && w > 0) {
                drawStars(ctx, w, h, g.elapsed * 6);
                for (const a of g.asteroids) drawAsteroid(ctx, a, w, h);
                const blink = g.grace > 0 && Math.floor(g.grace * 10) % 2 === 0;
                drawBalloon(ctx, g.x * w, BALLOON_Y * h, w * BALLOON_R, { blink, wobble: g.vx * 0.25 });
            }

            if (g.lives <= 0) {
                finish("popped", g.elapsed);
                return;
            }
            if (g.elapsed >= FLY_SECONDS) {
                finish("won", FLY_SECONDS);
                return;
            }
            const sec = Math.ceil(FLY_SECONDS - g.elapsed);
            if (sec !== lastSecond || g.lives !== lastLives) {
                lastSecond = sec;
                lastLives = g.lives;
                setHud({ seconds: FLY_SECONDS - g.elapsed, lives: g.lives });
            }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [phase, demoMode, reading, prepareCanvas, drawStars, finish]);

    const start = () => {
        pendingPumps.current = 0;
        held.current.clear();
        stats.current = {
            pumps: 0,
            pumpTime: 0,
            peak: 0,
            pumpSum: 0,
            pumpFrames: 0,
            dodged: 0,
            hits: 0,
            range: { min: 0, max: 0 },
        };
        setResult(null);
        setHud({ seconds: PUMP_SECONDS, lives: LIVES });
        setPhase("pump");
    };

    const pumpButtonDown = (e) => {
        e.preventDefault();
        pendingPumps.current++;
    };

    const timerLabel = phase === "pump" ? "Pump" : phase === "fly" ? "Fly" : "Time";
    const timerValue =
        phase === "pump" || phase === "fly"
            ? formatSeconds(hud.seconds)
            : phase === "done" && result?.outcome === "won"
                ? formatSeconds(0)
                : "--";

    return (
        <>
            <div className="game-bar">
                <button className="icon-btn" onClick={onExit} aria-label="Leave game">
                    <X size={22} aria-hidden="true" />
                </button>
                <div className="game-bar-title">
                    Balloon Rescue
                    <StepTag sessionStep={sessionStep} />
                </div>
                <div className="game-timer" aria-label={`${timerLabel} time left`}>
                    <Timer size={16} aria-hidden="true" /> {timerValue}
                </div>
            </div>
            <p className="sr-only" aria-live="polite">
                {phase === "pump" && "Pump the balloon to the brim before time runs out."}
                {phase === "fly" && "Rotate your wrist to dodge the asteroids."}
            </p>

            <div className="space-area" ref={areaRef}>
                <canvas ref={canvasRef} className="space-canvas" role="img" aria-label="Space scene with a balloon and asteroids" />

                {phase === "pump" && (
                    <>
                        <div className="space-meter" aria-hidden="true">
                            <div ref={meterFillRef} className="space-meter-fill" />
                            <span className="space-meter-brim">Brim</span>
                        </div>
                        <div className="space-chip">Pump it up!</div>
                    </>
                )}

                {phase === "fly" && (
                    <div className="space-lives" aria-label={`${hud.lives} lives left`}>
                        {Array.from({ length: LIVES }, (_, i) => (
                            <Heart key={i} size={22} fill={i < hud.lives ? "currentColor" : "none"} className={i < hud.lives ? "" : "is-lost"} aria-hidden="true" />
                        ))}
                    </div>
                )}

                {phase === "intro" && (
                    <div className="game-overlay">
                        <div className="overlay-card">
                            <div className="overlay-icon tint-peach">
                                <Rocket size={30} aria-hidden="true" />
                            </div>
                            <h2>Balloon Rescue</h2>
                            <ol className="steps">
                                <li>
                                    {demoMode ? "Tap the Space bar fast" : "Squeeze the grip again and again"} to pump the balloon to the
                                    brim in {PUMP_SECONDS} seconds.
                                </li>
                                <li>{demoMode ? "Use the left and right arrow keys" : "Rotate your wrist"} to steer the balloon.</li>
                                <li>
                                    Dodge the asteroids for {FLY_SECONDS} seconds. You have {LIVES} lives.
                                </li>
                            </ol>
                            {demoMode && <p className="overlay-note">Demo mode: this game won't be saved to your progress.</p>}
                            {!hasCalibration && (
                                <p className="overlay-note">
                                    First, take the 1-minute baseline assessment so pumping matches your grip.
                                </p>
                            )}
                            {hasCalibration && !canStart && (
                                <p className="overlay-note">Connect your AirGrip first, or turn on Demo mode to try it with the keyboard.</p>
                            )}
                            {!hasCalibration ? (
                                <button className="btn btn-primary btn-block" onClick={onOpenBaseline}>
                                    Start baseline assessment
                                </button>
                            ) : canStart ? (
                                <button className="btn btn-primary btn-block" onClick={start}>
                                    Start
                                </button>
                            ) : (
                                <button className="btn btn-primary btn-block" onClick={onReconnect}>
                                    Connect device
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {phase === "done" && result && (
                    <div className="game-overlay">
                        <div className="overlay-card">
                            <div className={`overlay-icon ${result.outcome === "won" ? "tint-mint" : "tint-peach"}`}>
                                {result.outcome === "won" ? <PartyPopper size={30} aria-hidden="true" /> : <Rocket size={30} aria-hidden="true" />}
                            </div>
                            <h2>
                                {result.outcome === "won"
                                    ? "Balloon rescued!"
                                    : result.outcome === "deflated"
                                        ? "Not quite full"
                                        : "The balloon popped"}
                            </h2>
                            {result.outcome === "deflated" ? (
                                <p className="overlay-note">
                                    The balloon didn't reach the brim in {PUMP_SECONDS} seconds. You pumped {result.pumps} times. Try
                                    pumping faster!
                                </p>
                            ) : (
                                <div className="result-stats result-stats--3">
                                    <div>
                                        <Hand size={18} aria-hidden="true" />
                                        <strong>{result.pumps}</strong>
                                        <span>pumps</span>
                                    </div>
                                    <div>
                                        <Trophy size={18} aria-hidden="true" />
                                        <strong>{result.dodged}</strong>
                                        <span>dodged</span>
                                    </div>
                                    <div>
                                        <RotateCw size={18} aria-hidden="true" />
                                        <strong>{result.rangeDeg}°</strong>
                                        <span>wrist range</span>
                                    </div>
                                </div>
                            )}
                            <p className="overlay-note">
                                {result.outcome === "deflated"
                                    ? "Nothing saved for this round."
                                    : result.saved
                                        ? "Saved to your progress."
                                        : notSavedText(demoMode)}
                            </p>
                            <ResultActions
                                sessionStep={sessionStep}
                                onNext={() => onNext?.(result)}
                                onPlayAgain={start}
                                onExit={onExit}
                            />
                        </div>
                    </div>
                )}
            </div>

            {phase === "pump" &&
                (demoMode ? (
                    <div className="hold-wrap">
                        <button className="hold-btn" onPointerDown={pumpButtonDown} onContextMenu={(e) => e.preventDefault()}>
                            <Hand size={24} aria-hidden="true" /> Tap to pump
                        </button>
                        <p className="game-hint">or tap the Space bar</p>
                    </div>
                ) : (
                    <p className="game-hint" style={{ marginTop: 16, textAlign: "center" }}>
                        Squeeze and release quickly to pump.
                    </p>
                ))}

            {phase === "fly" &&
                (demoMode ? (
                    <div className="hold-wrap">
                        <SidePad held={held} />
                        <p className="game-hint">or use the left and right arrow keys</p>
                    </div>
                ) : (
                    <p className="game-hint" style={{ marginTop: 16, textAlign: "center" }}>
                        Rotate your wrist left and right. Hold still to stay put.
                    </p>
                ))}
        </>
    );
}