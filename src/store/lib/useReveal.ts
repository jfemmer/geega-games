import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * For a message that appears away from the button that caused it. Our longer
 * forms show an error at the top and keep the button at the bottom; on a
 * phone the message then lands off screen, and the tap seems to do nothing.
 *
 * Put `ref` on the message and call `reveal()` whenever it is set: once the
 * message is on the page it is scrolled into view. Call it on every attempt,
 * not only when the wording changes, so a second tap that fails the same way
 * shows the message again.
 */
export function useReveal<T extends HTMLElement>(): [RefObject<T | null>, () => void] {
  const ref = useRef<T | null>(null);
  // Counts requests, so the effect below runs after the render that puts the
  // message on the page, including when its text is the same as last time.
  const [requests, setRequests] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (requests === 0 || !el || typeof el.scrollIntoView !== "function") return;
    const reduceMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Centered, not at the top edge, where the sticky header would cover it.
    el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }, [requests]);

  const reveal = useCallback(() => setRequests((n) => n + 1), []);
  return [ref, reveal];
}
