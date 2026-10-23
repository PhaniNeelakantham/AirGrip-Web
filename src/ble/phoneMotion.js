import { fromAngles } from "./orientation";

// "This phone" connection: the phone's own motion sensor stands in for the
// AirGrip's IMU, so the wrist games can be played holding just a phone
// (flat in the palm, screen up, top edge pointing the way the fingers do).
// There's no grip sensor, so the reading's pressure stays 0 and games that
// need a squeeze stay locked in this mode.
//
// The browser reports the phone's orientation as three angles:
//   beta  = front/back tilt (top edge up = positive)       -> pitch (hand up)
//   gamma = left/right tilt (right edge down = positive)   -> roll (turn right)
//   alpha = compass-style turn (counterclockwise = positive) -> yaw (wave left)
// Those are packed into the same quaternion the AirGrip sends, so every
// game reads them exactly like the real device.

export const phoneMotionSupported = () =>
  typeof window !== "undefined" && "DeviceOrientationEvent" in window;

// Asks for permission where needed (iPhone/iPad), then streams readings to
// `publish`. Resolves to a stop() function, or throws a friendly error.
// Must be started from a tap: iOS only allows the permission prompt then.
export async function startPhoneMotion(publish) {
  if (!phoneMotionSupported()) {
    throw new Error("This browser can't read motion sensors.");
  }
  // iPhone/iPad (and some newer browsers) ask first. What counts in the end
  // is whether motion readings actually arrive.
  const Orientation = window.DeviceOrientationEvent;
  let answer = "granted";
  if (typeof Orientation.requestPermission === "function") {
    answer = await Orientation.requestPermission().catch(() => "denied");
  }

  let gotReal = false;
  const onOrientation = (e) => {
    // Computers fire this event too, but with no values.
    if (e.beta === null || e.gamma === null) return;
    gotReal = true;
    const q = fromAngles({ pitch: e.beta, roll: e.gamma, yaw: e.alpha ?? 0 });
    publish({ forcePsi: 0, ...q });
  };
  window.addEventListener("deviceorientation", onOrientation);
  const stop = () => window.removeEventListener("deviceorientation", onOrientation);

  // No real values within a moment = no motion sensor (e.g. a laptop).
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
