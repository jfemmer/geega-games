import { useEffect, useState } from "react";

/**
 * The time now (ms), ticking every second while `running`, for game clocks.
 * `offset` is the server's clock minus this device's, so timers agree on the
 * TV and every phone even if a device's clock is off.
 */
export function useClock(running: boolean, offset = 0): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset, running]);
  return now;
}
