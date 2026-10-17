// Small helpers for Fishing's controls. Wrist positions are "reach":
// 0 = level, 1 = 70% of the player's comfortable range in that direction
// (from the baseline).

// Signed degrees -> reach, using the full angle for that direction.
export function toReach(deg, fullPos, fullNeg) {
  return deg >= 0 ? deg / fullPos : deg / fullNeg;
}

// Reeling: total back-and-forth wrist turning. The reading is smoothed first
// so a shaky hand doesn't reel by itself.
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
