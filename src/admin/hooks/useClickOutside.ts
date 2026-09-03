import { useEffect, type RefObject } from "react";

/** Calls `handler` when a pointer/touch happens outside `ref`, while enabled. */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  handler: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handler();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, enabled, handler]);
}
