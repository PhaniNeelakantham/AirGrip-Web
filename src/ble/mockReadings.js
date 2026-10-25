import { fromAngles } from "./orientation";

// Fake reading stream so the UI can be built and tested without the ESP32
export function startMockReadings(onReading, intervalMs = 20) {
  let t = 0;
  const id = setInterval(() => {
    t += intervalMs / 1000;
    const forcePsi = Math.max(0, 3 + 3 * Math.sin(t * 1.3));
    const q = fromAngles({
      pitch: 40 * Math.sin(t * 0.8),
      roll: 30 * Math.sin(t * 0.55 + 1),
      yaw: 50 * Math.sin(t * 0.35 + 2),
    });
    onReading({ forcePsi, ...q });
  }, intervalMs);
  return () => clearInterval(id);
}
