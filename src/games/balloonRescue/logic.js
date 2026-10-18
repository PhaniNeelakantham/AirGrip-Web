// Rules for Balloon Rescue. Positions are normalized: x runs 0..1 across the
// play area's width, y runs 0..1 down its height.
export const PUMP_SECONDS = 15; // time to fill the balloon
export const PUMP_GAIN = 0.16; // fill added per pump (squeeze or Space press)
export const PUMP_DECAY = 0.02; // fill leaked per second, so you can't stop pumping
export const FLY_SECONDS = 30;
export const LIVES = 3;
export const HIT_GRACE = 1.2; // seconds of invulnerability after a hit
export const BALLOON_Y = 0.82;
export const BALLOON_R = 0.07; // as a fraction of the area's width

// Asteroids arrive faster and quicker the longer you last (progress 0..1).
export function spawnDelay(progress) {
    return 0.95 - 0.5 * progress;
}

export function createAsteroid(id, progress) {
    return {
        id,
        x: 0.08 + Math.random() * 0.84,
        y: -0.08,
        r: 0.035 + Math.random() * 0.04,
        vy: 0.3 + 0.28 * progress + Math.random() * 0.12,
        vx: (Math.random() - 0.5) * 0.08,
        spin: (Math.random() - 0.5) * 3,
        angle: Math.random() * Math.PI * 2,
        seed: Math.random(),
        passed: false,
    };
}

// Moves an asteroid. Returns true once it is off the bottom of the screen.
export function stepAsteroid(a, dt) {
    a.y += a.vy * dt;
    a.x += a.vx * dt;
    a.angle += a.spin * dt;
    return a.y > 1.12;
}

// Circle hit test in pixels (width and height differ, so normalize first).
export function hitsBalloon(a, balloonX, w, h, scale = 1) {
    const dx = (a.x - balloonX) * w;
    const dy = (a.y - BALLOON_Y) * h;
    return Math.hypot(dx, dy) < (a.r + BALLOON_R * 0.82 * scale) * w;
}