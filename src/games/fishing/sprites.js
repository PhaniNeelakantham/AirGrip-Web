// Pixel-art sprites for Fishing, drawn once into small canvases (1 canvas
// pixel = 1 art pixel) and scaled up with smoothing off for the blocky look.
// Fish are generated from the numbers in fishTypes.js, so every species
// gets its own shape, colors and pattern without hand-drawn image files.

const canvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

// Lighten (amt > 0) or darken (amt < 0) a #rrggbb color.
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// How tall the body is along its length (t = 0 tail end .. 1 head end).
const PROFILES = {
  oval: (t) => Math.pow(Math.sin(Math.PI * t), 0.55),
  tall: (t) => Math.pow(Math.sin(Math.PI * t), 0.42),
  round: (t) => Math.pow(Math.max(0, 1 - (2 * t - 1) ** 2), 0.4),
  long: (t) => Math.min(1, Math.sin(Math.PI * t) * 1.7) ** 0.8,
  eel: (t) => Math.min(1, Math.sin(Math.PI * t) * 3.2),
};

// A fish facing right. Returns { canvas, w, h, cy, mouthX }.
function drawFish(f) {
  if (f.shape === "jelly") return drawJelly(f);
  if (f.shape === "angler") return drawAngler(f);
  const L = f.len;
  const H = f.ht;
  const tail = f.shape === "eel" ? 2 : Math.max(3, Math.round(H * 0.6));
  const bill = f.bill ?? 0;
  const finUp = f.shape === "tall" ? 3 : 2;
  const w = tail + L + bill + 1;
  const h = H + finUp * 2 + 3;
  const cy = Math.floor(h / 2);
  const x0 = tail;
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  const px = (x, y, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  const outline = shade(f.body, -0.45);
  const finOutline = shade(f.fin, -0.35);
  const profile = PROFILES[f.shape] ?? PROFILES.oval;
  const half = Array.from({ length: L }, (_, i) => Math.max(1, Math.round((profile((i + 0.5) / L) * H) / 2)));

  // Tail fin, flaring out behind the body, forked at the end.
  const spreadMax = Math.max(2, Math.round(H * 0.55));
  for (let i = 0; i < tail; i++) {
    const x = x0 - 1 - i;
    const spread = 1 + Math.round(((i + 1) / tail) * (spreadMax - 1));
    for (let dy = -spread; dy <= spread; dy++) {
      const fork = i >= tail - 2 && Math.abs(dy) < spread * 0.45 && tail > 3;
      if (fork) continue;
      px(x, cy + dy, Math.abs(dy) === spread || i === tail - 1 ? finOutline : f.fin);
    }
  }

  // Back (dorsal) fin and a small belly fin.
  for (let i = 0; i < L; i++) {
    const t = (i + 0.5) / L;
    const d = 1 - Math.abs(t - 0.45) / (f.shape === "eel" ? 0.45 : 0.2);
    if (d <= 0) continue;
    const fh = Math.max(1, Math.round(finUp * d));
    for (let k = 1; k <= fh; k++) px(x0 + i, cy - half[i] - k, k === fh ? finOutline : f.fin);
  }
  for (let i = Math.round(L * 0.5); i < Math.round(L * 0.62); i++) px(x0 + i, cy + half[i] + 1, f.fin);

  // Body with outline, lighter belly, and the pattern.
  for (let i = 0; i < L; i++) {
    const x = x0 + i;
    const hh = half[i];
    for (let dy = -hh; dy <= hh; dy++) {
      const edge = Math.abs(dy) === hh || i === 0 || i === L - 1;
      let col = dy > hh * 0.2 ? f.belly : f.body;
      if (f.pattern === "rainbow") {
        const hue = Math.round((i / L) * 300);
        col = dy > hh * 0.35 ? `hsl(${hue} 90% 88%)` : `hsl(${hue} 90% 62%)`;
      } else if (!edge) {
        const t = i / L;
        if (f.pattern === "stripes" && [0.3, 0.55, 0.78].some((s) => Math.abs(t - s) < 0.6 / L + 0.04)) col = f.accent;
        if (f.pattern === "spots" && dy < hh * 0.3 && (i * 7 + (dy + 9) * 13) % 6 === 0) col = f.accent;
        if (f.pattern === "band" && dy === 0 && t > 0.1 && t < 0.9) col = f.accent;
      }
      px(x, cy + dy, edge ? (f.pattern === "rainbow" ? `hsl(${Math.round((i / L) * 300)} 60% 35%)` : outline) : col);
    }
    // a soft shine along the back
    if (hh > 2 && i > L * 0.35 && i < L * 0.75) px(x, cy - hh + 1, shade(f.pattern === "rainbow" ? "#ffffff" : f.body, 0.35));
  }

  // Eye and mouth.
  const ei = L - Math.max(2, Math.round(L * 0.2));
  const ey = cy - Math.max(0, Math.round(half[ei] * 0.35));
  if (H >= 7) px(x0 + ei - 1, ey, "#ffffff");
  px(x0 + ei, ey, "#101418");
  px(x0 + L - 1, cy + (H >= 7 ? 1 : 0), outline);

  // Sword bill.
  for (let i = 0; i < bill; i++) px(x0 + L + i, cy, i === bill - 1 ? shade(f.fin, 0.3) : shade(f.belly, -0.15));

  return { canvas: c, w, h, cy, mouthX: x0 + L - 1 + bill };
}

function drawJelly(f) {
  const w = f.len + 2;
  const domeH = Math.round(f.ht * 0.55);
  const h = f.ht + 6;
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  const px = (x, y, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  const cx = (w - 1) / 2;
  for (let x = 0; x < w; x++) {
    const t = (x - cx) / (w / 2);
    const top = Math.round(domeH * (1 - Math.sqrt(Math.max(0, 1 - t * t)))) + 1;
    for (let y = top; y <= domeH + 1; y++) {
      const edge = y === top || x === 0 || x === w - 1;
      px(x, y, edge ? shade(f.body, -0.3) : y < top + 2 ? f.belly : f.body);
    }
  }
  // Tentacles.
  for (let k = 1; k < w - 1; k += 2) {
    for (let y = domeH + 2; y < h; y++) {
      const wob = Math.round(Math.sin(y * 0.9 + k) * 0.6);
      px(Math.min(w - 1, Math.max(0, k + wob)), y, y % 2 ? f.fin : f.belly);
    }
  }
  return { canvas: c, w, h, cy: Math.round(domeH / 2) + 1, mouthX: w - 1 };
}

function drawAngler(f) {
  const base = drawFish({ ...f, shape: "round" });
  const lureUp = 5;
  const w = base.w + 3;
  const h = base.h + lureUp;
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  ctx.drawImage(base.canvas, 0, lureUp);
  const px = (x, y, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };
  const cy = base.cy + lureUp;
  const head = base.mouthX;
  // Big toothy mouth.
  for (let i = 0; i < 3; i++) px(head - i, cy + 1, "#120c1c");
  px(head - 1, cy, "#ffffff");
  px(head - 2, cy + 2, "#ffffff");
  px(head, cy + 2, "#ffffff");
  // Lure on a stalk, curving forward.
  const sx = head - 3;
  const sy = cy - Math.round(f.ht / 2) - 1;
  const stalk = [
    [0, 0], [0, -1], [1, -2], [2, -3], [3, -4], [4, -4], [5, -3],
  ];
  stalk.forEach(([dx, dy]) => px(sx + dx, sy + dy, "#6d6290"));
  px(sx + 5, sy - 2, f.glow);
  px(sx + 6, sy - 2, f.glow);
  px(sx + 5, sy - 1, f.glow);
  px(sx + 6, sy - 1, "#ffffff");
  return { canvas: c, w, h, cy, mouthX: head + 1, lure: { x: sx + 6, y: sy - 1.5 } };
}

const mirror = (src) => {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext("2d");
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
};

const fishCache = new Map();

// { right, left, w, h, cy, mouthX (from the left edge, facing right), lure? }
export function fishSprite(f) {
  let s = fishCache.get(f.id);
  if (!s) {
    const d = drawFish(f);
    s = { ...d, right: d.canvas, left: mirror(d.canvas) };
    fishCache.set(f.id, s);
  }
  return s;
}

const urlCache = new Map();
// A picture of the fish for the page (catch card, collection).
export function fishImageUrl(f) {
  let url = urlCache.get(f.id);
  if (!url) {
    url = fishSprite(f).right.toDataURL();
    urlCache.set(f.id, url);
  }
  return url;
}

// ---- Boat, fisher, hook, clouds ----
export const BOAT_W = 32;
export const BOAT_H = 8;

export function boatSprite() {
  const c = canvas(BOAT_W, BOAT_H);
  const ctx = c.getContext("2d");
  for (let r = 0; r < BOAT_H; r++) {
    const left = Math.floor((r * r) / 7);
    const right = Math.floor((r * r) / 4.5);
    const col = r === 0 ? "#c98a52" : r === BOAT_H - 1 ? "#5a3519" : r % 2 ? "#8b5a2b" : "#7a4b22";
    ctx.fillStyle = col;
    ctx.fillRect(left, r, BOAT_W - left - right, 1);
    if (r > 1 && r < BOAT_H - 1) {
      ctx.fillStyle = "#5f3a1a";
      for (let x = left + 6; x < BOAT_W - right - 2; x += 8) ctx.fillRect(x, r, 1, 1);
    }
  }
  // A light wake along the waterline.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillRect(Math.floor(36 / 7), BOAT_H - 2, BOAT_W - 14, 1);
  return c;
}

const FISHER = [
  "...kkkk...",
  "..kkkkkk..",
  ".kkkkkkkk.",
  ".kkkkkkkk.",
  ".kkssssk..",
  "..ssssss..",
  "...sss....",
  "..hhhhhh..",
  ".hhhhhhhh.",
  ".hHhhhhss.",
  ".hHhhhsss.",
  ".hhhhhhh..",
  ".hhhhhhh..",
];
const FISHER_COLORS = { k: "#23232d", s: "#f2c4a2", h: "#7f9cc4", H: "#5e7ba3" };
export const FISHER_W = FISHER[0].length;
export const FISHER_H = FISHER.length;
export const FISHER_HANDS = { x: 8, y: 10 };

export function fisherSprite() {
  const c = canvas(FISHER_W, FISHER_H);
  const ctx = c.getContext("2d");
  FISHER.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (FISHER_COLORS[ch]) {
        ctx.fillStyle = FISHER_COLORS[ch];
        ctx.fillRect(x, y, 1, 1);
      }
    })
  );
  return c;
}

const HOOK = [".g.", ".g.", "g.g", "gg."];
export function hookSprite() {
  const c = canvas(3, 4);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#cfd8dc";
  HOOK.forEach((row, y) => [...row].forEach((ch, x) => ch === "g" && ctx.fillRect(x, y, 1, 1)));
  return c;
}

// A puffy cloud made of overlapping circles, with a shaded underside.
export function cloudSprite(size, seed) {
  const w = size * 2 + 6;
  const h = Math.round(size * 1.2) + 4;
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  const rand = (k) => {
    const v = Math.sin(seed * 97.1 + k * 31.7) * 43758.5;
    return v - Math.floor(v);
  };
  const blobs = [
    { x: size * 0.55, y: h - size * 0.45, r: size * 0.45 },
    { x: size * 1.0, y: h - size * 0.7, r: size * 0.6 + rand(1) * 2 },
    { x: size * 1.5, y: h - size * 0.45, r: size * 0.45 + rand(2) * 2 },
    { x: size * 1.85, y: h - size * 0.32, r: size * 0.32 },
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = blobs.some((b) => (x - b.x) ** 2 + (y - b.y) ** 2 <= b.r * b.r);
      if (!inside) continue;
      ctx.fillStyle = y > h - 4 ? "#cfe6f0" : y > h - 6 ? "#e6f4fa" : "#ffffff";
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}
