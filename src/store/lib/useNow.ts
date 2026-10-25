import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `everyMs` (a minute by default), so
 * "2 hours left" stays true while a page is open and renders stay pure.
 */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
