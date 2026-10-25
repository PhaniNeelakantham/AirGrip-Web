import { useEffect, useRef } from "react";

// While a panel is open, freeze the page behind it
export function useScrollLock() {
  const backdropRef = useRef(null);
  const panelRef = useRef(null);
  useEffect(() => {
    const y = window.scrollY;
    const body = document.body.style;
    const html = document.documentElement.style;
    const before = { position: body.position, top: body.top, width: body.width, overflow: body.overflow };
    const htmlOverflow = html.overflow;
    Object.assign(body, { position: "fixed", top: `-${y}px`, width: "100%", overflow: "hidden" });
    html.overflow = "hidden";
    const block = (e) => {
      if (!panelRef.current?.contains(e.target)) e.preventDefault();
    };
    const el = backdropRef.current;
    el?.addEventListener("wheel", block, { passive: false });
    el?.addEventListener("touchmove", block, { passive: false });
    return () => {
      el?.removeEventListener("wheel", block);
      el?.removeEventListener("touchmove", block);
      Object.assign(body, before);
      html.overflow = htmlOverflow;
      window.scrollTo(0, y);
    };
  }, []);
  return { backdropRef, panelRef };
}
