import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Taps on a counter (life, poison, commander damage) that change the number
 * straight away and reach the server in batches: a quick run of taps is one
 * request, sent `delayMs` after the last tap. Changes go one batch at a
 * time, in order. `pending` is what's been tapped but not saved yet (add it
 * to the saved value to show). `flush()` sends anything waiting and resolves
 * once nothing is on its way, e.g. before recording a loss. Waiting taps are
 * also sent when the page is hidden (phone locked) or the counter goes away.
 */
export function useBatchedTaps(send: (delta: number) => Promise<boolean>, delayMs = 450) {
  const sendFn = useRef(send);
  useEffect(() => {
    sendFn.current = send;
  }, [send]);

  const queued = useRef(0);
  const current = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [queuedView, setQueuedView] = useState(0);
  const [inFlight, setInFlight] = useState(0);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    while (queued.current !== 0) {
      // One batch at a time: wait for the one on its way, then send what's queued since.
      if (current.current) {
        await current.current;
        continue;
      }
      const delta = queued.current;
      queued.current = 0;
      setQueuedView(0);
      setInFlight(delta);
      const request = sendFn.current(delta).then(
        () => undefined,
        () => undefined,
      );
      current.current = request;
      await request;
      current.current = null;
      setInFlight(0);
    }
    if (current.current) await current.current;
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  const tap = useCallback(
    (delta: number) => {
      queued.current += delta;
      setQueuedView(queued.current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [delayMs, flush],
  );

  return { pending: inFlight + queuedView, tap, flush };
}
