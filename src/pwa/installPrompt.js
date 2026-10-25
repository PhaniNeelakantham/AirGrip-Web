import { useSyncExternalStore } from "react";

// Chrome/Edge fire `beforeinstallprompt` once
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

const standaloneQuery = window.matchMedia("(display-mode: standalone)");
const isInstalled = () => standaloneQuery.matches || window.navigator.standalone === true;
standaloneQuery.addEventListener("change", () => notify());

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // show our own button instead of the browser's
  deferredPrompt = e;
  notify();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  notify();
});

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// "installed", "ready", or "manual"
export function useInstallState() {
  return useSyncExternalStore(subscribe, () =>
    isInstalled() ? "installed" : deferredPrompt ? "ready" : "manual"
  );
}

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  notify();
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome === "accepted";
}
