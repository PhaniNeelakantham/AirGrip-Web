// The 20 fish, in five depth zones. Deeper = rarer = a stronger squeeze to
// hook (as a share of the player's comfortable max from the baseline) and a
// little more reeling. Sprites are drawn from these numbers in sprites.js.

export const TIERS = [
  { id: "common", label: "Common", zone: "Shallows", color: "#7bd88f", grip: 0.3, hold: 0.7, reel: 3, points: 10 },
  { id: "uncommon", label: "Uncommon", zone: "Reef", color: "#4fc3f7", grip: 0.4, hold: 0.85, reel: 3.6, points: 25 },
  { id: "rare", label: "Rare", zone: "Deep", color: "#b388ff", grip: 0.5, hold: 1, reel: 4.2, points: 60 },
  { id: "epic", label: "Epic", zone: "Abyss", color: "#ff7ad9", grip: 0.62, hold: 1.15, reel: 4.8, points: 150 },
  { id: "legendary", label: "Legendary", zone: "Trench", color: "#ffd54a", grip: 0.75, hold: 1.3, reel: 5.5, points: 400 },
];

// shape: oval | round | long | tall | eel | jelly | angler
// pattern: none | stripes | spots | band | rainbow
export const FISH = [
  // ---- Shallows (common) ----
  { id: "minnow", name: "Minnow", tier: 0, shape: "long", len: 9, ht: 4, body: "#c9d6df", belly: "#eef3f6", fin: "#9fb3c2", pattern: "band", accent: "#7f97a8", speed: 13 },
  { id: "bluegill", name: "Bluegill", tier: 0, shape: "tall", len: 11, ht: 8, body: "#4d8fbf", belly: "#f2c14e", fin: "#3a6f99", pattern: "stripes", accent: "#3a6f99", speed: 9 },
  { id: "sardine", name: "Sardine", tier: 0, shape: "long", len: 10, ht: 4, body: "#8fb5cf", belly: "#f4f7fa", fin: "#6d93ad", pattern: "spots", accent: "#365d78", speed: 15 },
  { id: "goldfish", name: "Goldfish", tier: 0, shape: "round", len: 9, ht: 7, body: "#ff9f1c", belly: "#ffd166", fin: "#ff7b00", pattern: "none", speed: 8 },

  // ---- Reef (uncommon) ----
  { id: "clownfish", name: "Clownfish", tier: 1, shape: "oval", len: 11, ht: 7, body: "#ff7f11", belly: "#ffa94d", fin: "#1b1b1b", pattern: "stripes", accent: "#ffffff", speed: 9 },
  { id: "parrotfish", name: "Parrotfish", tier: 1, shape: "oval", len: 13, ht: 8, body: "#2ec4b6", belly: "#cbf3f0", fin: "#ff70a6", pattern: "spots", accent: "#ff70a6", speed: 8 },
  { id: "angelfish", name: "Angelfish", tier: 1, shape: "tall", len: 10, ht: 11, body: "#ffd23f", belly: "#fff3b0", fin: "#3a86ff", pattern: "stripes", accent: "#3a86ff", speed: 7 },
  { id: "pufferfish", name: "Pufferfish", tier: 1, shape: "round", len: 10, ht: 9, body: "#e9c46a", belly: "#fefae0", fin: "#bc8a3a", pattern: "spots", accent: "#6b4f1d", speed: 6 },

  // ---- Deep (rare) ----
  { id: "barracuda", name: "Barracuda", tier: 2, shape: "long", len: 18, ht: 5, body: "#7d8fa3", belly: "#dfe7ee", fin: "#56677a", pattern: "spots", accent: "#2f3d4c", speed: 16 },
  { id: "lionfish", name: "Lionfish", tier: 2, shape: "tall", len: 12, ht: 10, body: "#e63946", belly: "#ffd6d6", fin: "#ffb4a2", pattern: "stripes", accent: "#fff1e6", speed: 7 },
  { id: "moray", name: "Moray Eel", tier: 2, shape: "eel", len: 22, ht: 4, body: "#5b8c3a", belly: "#c2d97c", fin: "#3f6627", pattern: "spots", accent: "#e9f5a0", speed: 9 },
  { id: "seabass", name: "Giant Sea Bass", tier: 2, shape: "oval", len: 17, ht: 10, body: "#465a6b", belly: "#a7b7c4", fin: "#2f3e4a", pattern: "spots", accent: "#26313b", speed: 7 },

  // ---- Abyss (epic) ----
  { id: "jelly", name: "Glow Jelly", tier: 3, shape: "jelly", len: 10, ht: 9, body: "#c77dff", belly: "#f3c4fb", fin: "#9d4edd", pattern: "none", glow: "#e0aaff", speed: 4 },
  { id: "opah", name: "Moonfish", tier: 3, shape: "tall", len: 15, ht: 12, body: "#ef476f", belly: "#ffd6e0", fin: "#ff9f1c", pattern: "spots", accent: "#ffffff", speed: 7, glow: "#ff9ebd" },
  { id: "swordfish", name: "Swordfish", tier: 3, shape: "long", len: 18, ht: 7, body: "#3d5a80", belly: "#c9d6ea", fin: "#293d5a", pattern: "none", bill: 7, speed: 18, glow: "#98c1d9" },
  { id: "ghostshark", name: "Ghost Shark", tier: 3, shape: "long", len: 20, ht: 7, body: "#b8c0ff", belly: "#e7e9ff", fin: "#8e94f2", pattern: "spots", accent: "#ffffff", speed: 9, glow: "#c8ceff" },

  // ---- Trench (legendary) ----
  { id: "angler", name: "Anglerfish", tier: 4, shape: "angler", len: 14, ht: 11, body: "#3a3150", belly: "#5b4d7a", fin: "#2a2340", pattern: "none", glow: "#fff176", speed: 5 },
  { id: "coelacanth", name: "Coelacanth", tier: 4, shape: "oval", len: 20, ht: 10, body: "#355c7d", belly: "#6c8ead", fin: "#2a4a66", pattern: "spots", accent: "#e8f1f8", speed: 6, glow: "#7fb3e6" },
  { id: "oarfish", name: "Oarfish", tier: 4, shape: "eel", len: 30, ht: 5, body: "#e0e6ed", belly: "#ffffff", fin: "#ff3b3b", pattern: "spots", accent: "#7d8da1", speed: 7, glow: "#ffb3b3" },
  { id: "prism", name: "Prismfish", tier: 4, shape: "oval", len: 15, ht: 9, body: "#ff5d8f", belly: "#ffffff", fin: "#7c4dff", pattern: "rainbow", speed: 10, glow: "#ffffff" },
];

export const FISH_BY_ID = Object.fromEntries(FISH.map((f) => [f.id, f]));
export const ZONE_COUNT = TIERS.length;
// How many fish swim in each zone at once: fewer the deeper you go.
export const ZONE_POPULATION = [4, 3, 3, 2, 2];
