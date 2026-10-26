// Rules for Fishing

// Five catches per round, getting a little bigger each time
export const FISH = [
  { id: "minnow", name: "Minnow", color: "#f2b84b", size: 0.75, grip: 0.3, reel: 4 },
  { id: "sunfish", name: "Sunfish", color: "#f28a3c", size: 0.85, grip: 0.35, reel: 4.5 },
  { id: "perch", name: "Perch", color: "#7cb342", size: 0.95, grip: 0.42, reel: 5.5 },
  { id: "trout", name: "Rainbow trout", color: "#e5739a", size: 1.05, grip: 0.48, reel: 6 },
  { id: "bass", name: "Big bass", color: "#3f9d6c", size: 1.15, grip: 0.55, reel: 7 },
];

export const AIM_TOLERANCE = 0.2; // how close the rod must point to the fish
export const AIM_HOLD_S = 0.8; // ...and for how long
export const LIFT_GOAL = 0.6; // tilt up this far to lift the rod
export const CAST_GOAL = -0.35; // then tilt down this far to cast
export const HOOK_HOLD_S = 1; // hold the squeeze this long to hook the fish

// Signed degrees -> reach, using the full angle for that direction
export function toReach(deg, fullPos, fullNeg) {
  return deg >= 0 ? deg / fullPos : deg / fullNeg;
}

// Where the next fish waits, as reach left/right: never straight ahead
export function fishAim(rodReach = 0) {
  const far = 0.4 + Math.random() * 0.35;
  const side = Math.abs(rodReach) < 0.1 ? (Math.random() < 0.5 ? 1 : -1) : rodReach > 0 ? -1 : 1;
  return side * far;
}

// Reeling: total back-and-forth wrist turning
export function createReel() {
  let smooth = null;
  let travel = 0;
  return {
    update(reach, dt) {
      if (smooth === null) smooth = reach;
      const next = smooth + (reach - smooth) * Math.min(1, dt / 0.08);
      const step = Math.abs(next - smooth);
      if (step > 0.003) travel += Math.min(step, 0.3);
      smooth = next;
      return travel;
    },
  };
}
