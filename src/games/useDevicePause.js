import { useCallback, useEffect, useRef, useState } from "react";

const STALE_MS = 1500; // no data for this long counts as a lost link

// Pauses a real-device game when the AquaGrip link drops or goes silent.
// The game stays paused after the link returns until the player taps
// Resume, so it never restarts while their hand is somewhere else.
// Demo mode never pauses: it doesn't depend on the device.
export function useDevicePause({ active, demoMode, connectionState, lastDataAtRef }) {
  const [stale, setStale] = useState(false);
  const [needsResume, setNeedsResume] = useState(false);
  const watching = active && !demoMode;

  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => {
      setStale(performance.now() - lastDataAtRef.current > STALE_MS);
    }, 250);
    return () => {
      clearInterval(id);
      setStale(false);
    };
  }, [watching, lastDataAtRef]);

  const lost = watching && (connectionState !== "connected" || stale);
  // Still connected, but readings stopped: the sensor itself went quiet
  // (the firmware restarts it), not the Bluetooth / USB link.
  const silent = lost && connectionState === "connected";
  if (lost && !needsResume) setNeedsResume(true);
  const paused = watching && needsResume;

  // The frame loop reads this, so pausing never restarts the game.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const resume = useCallback(() => setNeedsResume(false), []);
  return { lost, silent, paused, pausedRef, resume };
}
