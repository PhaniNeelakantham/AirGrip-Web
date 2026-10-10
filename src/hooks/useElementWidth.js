import { useLayoutEffect, useState } from "react";

// Width of an element, measured before the browser paints so a chart never
// shows an empty first frame, then kept up to date as it resizes.
export function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
