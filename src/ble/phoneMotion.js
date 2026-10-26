import { fromAngles } from "./orientation";

// "This phone" mode: the phone's motion sensor stands in for the IMU (no grip)
// beta -> pitch, gamma -> roll, alpha -> yaw

export const phoneMotionSupported = () =>
  typeof window !== "undefined" && "DeviceOrientationEvent" in window;

// Asks for permission where needed, then streams readings to `publish`
export async function startPhoneMotion(publish) {
  if (!phoneMotionSupported()) {
    throw new Error("This browser can't read motion sensors.");
  }
  // iOS asks for permission; what counts is whether data arrives
  const Orientation = window.DeviceOrientationEvent;
  let answer = "granted";
  if (typeof Orientation.requestPermission === "function") {
    answer = await Orientation.requestPermission().catch(() => "denied");
  }

  let gotReal = false;
  const onOrientation = (e) => {
    // Computers fire this event too, but with no values
    if (e.beta === null || e.gamma === null) return;
    gotReal = true;
    const q = fromAngles({ pitch: e.beta, roll: e.gamma, yaw: e.alpha ?? 0 });
    publish({ forcePsi: 0, ...q });
  };
  window.addEventListener("deviceorientation", onOrientation);
  const stop = () => window.removeEventListener("deviceorientation", onOrientation);

  // No real values within a moment = no motion sensor
  await new Promise((r) => setTimeout(r, 1500));
  if (!gotReal) {
    stop();
    throw new Error(
      answer === "granted"
        ? "No motion sensor found. Phone mode works on a phone or tablet."
        : "Motion access was not allowed. Allow motion & orientation access for this site, then try again."
    );
  }
  return stop;
}
