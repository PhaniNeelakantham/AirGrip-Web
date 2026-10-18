// The Fishing world: layout, fish that swim in depth zones, and drawing the
// whole scene into a small pixel canvas each frame. The game rules (stages,
// squeeze, reel, score) live in Fishing.jsx; this file only knows the world.
import { FISH, TIERS, ZONE_COUNT, ZONE_POPULATION } from "./fishTypes";
import {
  BOAT_W,
  BOAT_H,
  FISHER_H,
  FISHER_HANDS,
  boatSprite,
  cloudSprite,
  fishSprite,
  fisherSprite,
  hookSprite,
} from "./sprites";

// Art pixels across: about one per 3.6 screen pixels, so the pixels look
// the same size on a phone and a laptop. The height follows the screen.
export const viewWidthFor = (cssWidth) => Math.max(112, Math.min(220, Math.round(cssWidth / 3.6)));

const SKY_TOP = "#4fc8ef";
const SKY_BOTTOM = "#c6f2f8";
// Water color at the top of each zone, then the very bottom.
const WATER = ["#45cdec", "#1fa0d8", "#1868b2", "#153c7a", "#0c1c45", "#070e26"];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export function createLayout(W, H) {
  const surfaceY = Math.round(H * 0.24);
  const seabedY = H - 7;
  const waterTop = surfaceY + 3;
  const span = seabedY - 3 - waterTop;
  const zoneH = span / ZONE_COUNT;
  return {
    W,
    H,
    surfaceY,
    seabedY,
    waterTop,
    span,
    zoneH,
    zoneTop: (z) => waterTop + z * zoneH,
    // Hook depth 0..1 runs from the middle of the top zone to the middle of
    // the bottom one, so full depth lands right among the trench fish.
    depthY: (d) => waterTop + zoneH / 2 + clamp(d, 0, 1) * (span - zoneH),
    depthOfY: (y) => clamp((y - waterTop - zoneH / 2) / (span - zoneH), 0, 1),
    zoneOfY: (y) => clamp(Math.floor((y - waterTop) / zoneH), 0, ZONE_COUNT - 1),
  };
}

// Water color at a depth (0 = surface, 1 = bottom).
const waterAt = (d) => {
  const f = clamp(d, 0, 1) * (WATER.length - 1);
  const i = Math.min(WATER.length - 2, Math.floor(f));
  return mix(WATER[i], WATER[i + 1], f - i);
};

// Sky, water bands (dithered for a pixel-art look), zone lines, seabed.
function makeBackground(L) {
  const c = document.createElement("canvas");
  c.width = L.W;
  c.height = L.H;
  const ctx = c.getContext("2d");
  const px = (x, y, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  const SKY_BANDS = 6;
  for (let y = 0; y < L.surfaceY + 2; y++) {
    const band = Math.min(SKY_BANDS - 1, Math.floor((y / (L.surfaceY + 2)) * SKY_BANDS));
    ctx.fillStyle = mix(SKY_TOP, SKY_BOTTOM, band / (SKY_BANDS - 1));
    ctx.fillRect(0, y, L.W, 1);
  }
  const STEPS = 28;
  for (let y = L.surfaceY; y < L.H; y++) {
    const d = (y - L.waterTop) / L.span;
    const f = clamp(d, 0, 1) * STEPS;
    const base = Math.floor(f);
    const frac = f - base;
    const a = waterAt(base / STEPS);
    const b = waterAt((base + 1) / STEPS);
    for (let x = 0; x < L.W; x++) px(x, y, frac > 0.5 && (x + y) % 2 === 0 ? b : a);
  }
  // Zone boundaries: faint dotted lines, and a colored strip on the left.
  for (let z = 0; z < ZONE_COUNT; z++) {
    const top = Math.round(L.zoneTop(z));
    const bottom = Math.round(L.zoneTop(z + 1));
    ctx.fillStyle = TIERS[z].color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, top + 1, 2, bottom - top - 1);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = "#ffffff";
    if (z > 0) for (let x = 3; x < L.W; x += 4) ctx.fillRect(x, top, 2, 1);
    ctx.globalAlpha = 1;
  }
  // Seabed.
  for (let x = 0; x < L.W; x++) {
    const top = L.seabedY - Math.round(1.5 + Math.sin(x * 0.21) * 1.2 + Math.sin(x * 0.07 + 1) * 1.3);
    for (let y = top; y < L.H; y++) px(x, y, y === top ? "#4c3f72" : (x * 5 + y * 3) % 11 === 0 ? "#3a3058" : "#2a2347");
  }
  return c;
}

export function createWorld(W, H) {
  const L = createLayout(W, H);
  const world = {
    L,
    bg: makeBackground(L),
    boat: boatSprite(),
    fisher: fisherSprite(),
    hookImg: hookSprite(),
    clouds: [
      { img: cloudSprite(10, 1), x: rand(0, W), y: L.surfaceY * 0.18, speed: 1.6 },
      { img: cloudSprite(7, 2), x: rand(0, W), y: L.surfaceY * 0.45, speed: 2.4 },
      { img: cloudSprite(5, 3), x: rand(0, W), y: L.surfaceY * 0.1, speed: 3 },
    ],
    weeds: Array.from({ length: 9 }, (_, i) => ({
      x: Math.round(((i + rand(0.1, 0.9)) / 9) * W),
      h: Math.round(rand(4, 10)),
      color: i % 3 === 0 ? "#7b5ea7" : "#2e9e8f",
      seed: rand(0, 6),
    })),
    sparks: Array.from({ length: 10 }, () => ({ x: rand(2, W - 2), y: rand(L.zoneTop(4) + 3, L.seabedY - 3), seed: rand(0, 6) })),
    fishes: [],
    zoneNext: Array(ZONE_COUNT).fill(0),
    bubbles: [],
    particles: [],
    curious: null,
    t: 0,
  };
  for (let z = 0; z < ZONE_COUNT; z++) for (let i = 0; i < population(world, z); i++) spawnFish(world, z, true);
  return world;
}

// A wider lake (laptop) holds proportionally more fish.
const population = (world, z) => Math.round(ZONE_POPULATION[z] * Math.max(1, world.L.W / 112));

function spawnFish(world, z, anywhere) {
  const { L } = world;
  const options = FISH.filter((f) => f.tier === z);
  const sp = options[Math.floor(Math.random() * options.length)];
  const s = fishSprite(sp);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const halfH = s.h / 2 - 1;
  const top = L.zoneTop(z) + halfH;
  const bottom = Math.min(L.zoneTop(z + 1), L.seabedY - 3) - halfH;
  const baseY = top < bottom ? rand(top, bottom) : (top + bottom) / 2;
  world.fishes.push({
    sp,
    s,
    dir,
    x: anywhere ? rand(10, L.W - 10) : dir > 0 ? -s.w / 2 - 2 : L.W + s.w / 2 + 2,
    baseY,
    y: baseY,
    speed: sp.speed * rand(0.8, 1.2),
    phase: rand(0, 6),
    zone: z,
    state: "swim", // swim | curious | hooked | flee
  });
}

// Where the fish's mouth is (the hook goes there).
export const mouthOf = (f) => ({ x: f.x + f.dir * (f.s.mouthX - f.s.w / 2), y: f.y });

// Move everything for one frame. `hook` = where the hook is; `canBite`
// lets fish come over to it. Returns a fish that just bit, or null.
export function stepWorld(world, dt, hook, canBite) {
  const { L } = world;
  world.t += dt;
  const t = world.t;

  for (const c of world.clouds) {
    c.x += c.speed * dt;
    if (c.x > L.W + 4) c.x = -c.img.width - 4;
  }

  // Spawn so each zone keeps its population (fewer, rarer fish deeper).
  for (let z = 0; z < ZONE_COUNT; z++) {
    const count = world.fishes.filter((f) => f.zone === z && f.state !== "flee").length;
    world.zoneNext[z] -= dt;
    if (count < population(world, z) && world.zoneNext[z] <= 0) {
      spawnFish(world, z, false);
      world.zoneNext[z] = rand(1.5, 4) + z * 0.4;
    }
  }

  let bit = null;
  for (const f of world.fishes) {
    if (f.state === "hooked") continue;
    if (f.state === "swim") {
      f.x += f.dir * f.speed * dt;
      // Drift back to its own depth (after following the hook), with a gentle bob.
      const y = f.baseY + Math.sin(f.phase + t * 1.6) * 0.8;
      f.y += clamp(y - f.y, -6 * dt, 6 * dt);
    } else if (f.state === "flee") {
      f.x += f.dir * f.speed * 3.5 * dt;
    } else if (f.state === "curious") {
      // Swim over so the mouth meets the hook.
      const tx = hook.x - f.dir * (f.s.mouthX - f.s.w / 2);
      f.x += clamp(tx - f.x, -f.speed * 1.5 * dt, f.speed * 1.5 * dt);
      f.y += clamp(hook.y - f.y, -10 * dt, 10 * dt);
      const m = mouthOf(f);
      // Gives up only if the hook moves well away (or ends up behind it).
      const lost = !canBite || Math.abs(hook.y - f.y) > 22 || Math.sign(hook.x - f.x) !== f.dir;
      if (lost) {
        f.state = "swim";
        world.curious = null;
      } else if (Math.abs(m.x - hook.x) < 1.5 && Math.abs(m.y - hook.y) < 1.5) {
        bit = f;
      }
    }
  }

  // The nearest fish swimming toward the hook at about its depth gets curious.
  if (canBite && !world.curious) {
    let best = null;
    let bestD = Infinity;
    for (const f of world.fishes) {
      if (f.state !== "swim") continue;
      const dx = hook.x - f.x;
      const dy = Math.abs(hook.y - f.y);
      // Rare fish are scarce, so they notice the hook from farther away.
      const reachX = 28 + f.zone * 6;
      if (dy > Math.max(6, f.sp.ht * 0.8 + 3) || Math.abs(dx) > reachX || Math.sign(dx) !== f.dir) continue;
      const d = Math.abs(dx) + dy * 2;
      if (d < bestD) {
        best = f;
        bestD = d;
      }
    }
    if (best) {
      best.state = "curious";
      world.curious = best;
    }
  }

  world.fishes = world.fishes.filter((f) => {
    const out = f.x < -f.s.w - 6 || f.x > L.W + f.s.w + 6;
    if (out && world.curious === f) world.curious = null;
    return !out || f.state === "hooked";
  });

  // Bubbles from the seabed and from a hooked fish.
  if (Math.random() < dt * 2.5) {
    const w = world.weeds[Math.floor(Math.random() * world.weeds.length)];
    world.bubbles.push({ x: w.x, y: L.seabedY - w.h, seed: rand(0, 6) });
  }
  for (const b of world.bubbles) b.y -= 7 * dt;
  world.bubbles = world.bubbles.filter((b) => b.y > L.surfaceY + 2);

  for (const p of world.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 60 * dt;
    p.life -= dt;
  }
  world.particles = world.particles.filter((p) => p.life > 0);
  return bit;
}

export function splash(world, x, big) {
  const n = big ? 16 : 8;
  for (let i = 0; i < n; i++) {
    world.particles.push({
      x,
      y: world.L.surfaceY,
      vx: rand(-18, 18),
      vy: rand(-38, -14),
      life: rand(0.4, 0.8),
      color: i % 3 ? "#ffffff" : "#9be7f5",
    });
  }
}

// The boat and rod for a boat position (left edge of the boat).
export function rigAt(world, boatX) {
  const { L } = world;
  const boatY = L.surfaceY - BOAT_H + 3 + Math.round(Math.sin(world.t * 2) * 0.6);
  const fisherX = Math.round(boatX) + 6;
  const fisherY = boatY - FISHER_H + 4;
  const hand = { x: fisherX + FISHER_HANDS.x, y: fisherY + FISHER_HANDS.y };
  const tip = { x: hand.x + 14, y: hand.y - 12 };
  return { boatX: Math.round(boatX), boatY, fisherX, fisherY, hand, tip };
}
// Rod tip x for a boat position, and the boat position for a rod tip x.
export const TIP_FROM_BOAT = 6 + FISHER_HANDS.x + 14;
export const boatForTip = (tipX) => tipX - TIP_FROM_BOAT;

function drawLine(ctx, x0, y0, x1, y1, color) {
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const steps = Math.max(dx, dy, 1);
  for (let i = 0; i <= steps; i++) {
    ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), 1, 1);
  }
}

function drawFish(ctx, f, x, y, t) {
  const s = f.s;
  if (f.sp.glow) {
    const r = Math.max(s.w, s.h) * 0.85;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, f.sp.glow + "66");
    g.addColorStop(1, f.sp.glow + "00");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.drawImage(f.dir > 0 ? s.right : s.left, Math.round(x - s.w / 2), Math.round(y - s.cy));
  if (s.lure) {
    // Anglerfish lure pulses.
    const lx = Math.round(x + f.dir * (s.lure.x - s.w / 2));
    const ly = Math.round(y - s.cy + s.lure.y);
    const r = 4 + Math.sin(t * 4) * 1.2;
    const g = ctx.createRadialGradient(lx, ly, 0.5, lx, ly, r);
    g.addColorStop(0, "#fff7a8cc");
    g.addColorStop(1, "#fff7a800");
    ctx.fillStyle = g;
    ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
  }
  if (f.sp.tier === 4) {
    // Legendary sparkle.
    ctx.fillStyle = "#ffffff";
    for (let k = 0; k < 3; k++) {
      const a = t * 1.5 + k * 2.1 + f.phase;
      if (Math.sin(t * 6 + k * 3 + f.phase) > 0.3) {
        ctx.fillRect(Math.round(x + Math.cos(a) * s.w * 0.6), Math.round(y + Math.sin(a) * s.h * 0.6), 1, 1);
      }
    }
  }
}

// state: { boatX, hook: {x, y}, active (hooked fish), ring: {progress, color, warn}, flying }
export function drawWorld(ctx, world, state) {
  const { L } = world;
  const t = world.t;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(world.bg, 0, 0);

  for (const c of world.clouds) ctx.drawImage(c.img, Math.round(c.x), Math.round(c.y));

  // Sun rays in the shallows.
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  const rayBottom = L.zoneTop(1.6);
  for (let k = 0; k < 3; k++) {
    const rx = ((k * 47 + t * 3) % (L.W + 40)) - 20;
    for (let y = L.waterTop; y < rayBottom; y++) ctx.fillRect(Math.round(rx + (y - L.waterTop) * 0.45), y, 4, 1);
  }

  // Seaweed and glowing specks in the trench.
  for (const w of world.weeds) {
    ctx.fillStyle = w.color;
    for (let k = 0; k < w.h; k++) {
      const sway = Math.round(Math.sin(t * 1.4 + w.seed + k * 0.45) * 1.3 * (k / w.h));
      ctx.fillRect(w.x + sway, L.seabedY - 2 - k, 1, 1);
    }
  }
  for (const s of world.sparks) {
    if (Math.sin(t * 2 + s.seed * 3) > 0.4) {
      ctx.fillStyle = "#8ff3ff";
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
  }

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (const b of world.bubbles) {
    ctx.fillRect(Math.round(b.x + Math.sin(t * 3 + b.seed)), Math.round(b.y), 1, 1);
  }

  for (const f of world.fishes) {
    if (f.state === "hooked") continue;
    drawFish(ctx, f, f.x, f.y, t);
  }

  // Waves along the surface.
  for (let x = 0; x < L.W; x++) {
    const yy = L.surfaceY + Math.round(Math.sin(x * 0.28 + t * 1.6) * 0.7 + Math.sin(x * 0.09 - t * 0.8) * 0.6);
    if (yy < L.surfaceY) {
      ctx.fillStyle = WATER[0];
      ctx.fillRect(x, yy, 1, L.surfaceY - yy + 1);
    } else if (yy > L.surfaceY) {
      ctx.fillStyle = SKY_BOTTOM;
      ctx.fillRect(x, L.surfaceY, 1, yy - L.surfaceY);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, yy, 1, 1);
    ctx.fillStyle = "#a4ecf7";
    ctx.fillRect(x, yy + 1, 1, 1);
  }

  // Boat, fisher, rod.
  const rig = rigAt(world, state.boatX);
  ctx.drawImage(world.fisher, rig.fisherX, rig.fisherY);
  ctx.drawImage(world.boat, rig.boatX, rig.boatY);
  const bend = state.active ? 4 : 0; // the rod bends with a fish on
  ctx.fillStyle = "#9a6334";
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const x = rig.hand.x + (rig.tip.x - rig.hand.x) * u;
    const y = rig.hand.y + (rig.tip.y - rig.hand.y) * u + Math.sin(u * Math.PI * 0.9) * -3 + bend * u * u;
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  const tipY = rig.tip.y + bend;

  // Line, bobber at the surface, hook.
  if (state.hook) {
    const h = state.hook;
    drawLine(ctx, rig.tip.x, tipY, Math.round(h.x), Math.round(h.y) - 2, "rgba(255,255,255,0.75)");
    const bx = Math.round(rig.tip.x + (h.x - rig.tip.x) * ((L.surfaceY - tipY) / Math.max(1, h.y - tipY)));
    if (h.y > L.surfaceY + 2) {
      ctx.fillStyle = "#e53935";
      ctx.fillRect(bx - 1, L.surfaceY - 2, 2, 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(bx - 1, L.surfaceY - 1, 2, 1);
    }
    ctx.drawImage(world.hookImg, Math.round(h.x) - 1, Math.round(h.y) - 2);
  }

  if (state.active) {
    const f = state.active;
    const m = { x: state.hook.x, y: state.hook.y };
    const wiggle = Math.sin(t * 22) * 0.8;
    drawFish(ctx, f, m.x - f.dir * (f.s.mouthX - f.s.w / 2) + wiggle, m.y, t);
  }

  // Hook ring: fills while the squeeze holds the fish.
  if (state.ring && state.hook) {
    const N = 16;
    const lit = Math.round(state.ring.progress * N);
    const r = Math.max(9, (state.active?.s.w ?? 10) * 0.55);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      const on = i < lit;
      ctx.fillStyle = on ? state.ring.color : state.ring.warn && Math.sin(t * 10) > 0 ? "#ff8a80" : "#ffffffcc";
      ctx.fillRect(Math.round(state.hook.x + Math.cos(a) * r) - 1, Math.round(state.hook.y + Math.sin(a) * r) - 1, 2, 2);
    }
  }

  for (const p of world.particles) {
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
  }

  // A caught fish leaps from the water into the boat.
  if (state.flying) {
    const { f, u, from } = state.flying;
    const to = { x: rig.boatX + BOAT_W / 2, y: rig.boatY - 2 };
    const x = from.x + (to.x - from.x) * u;
    const y = from.y + (to.y - from.y) * u - Math.sin(u * Math.PI) * 18;
    drawFish(ctx, f, x, y, t);
  }
}
