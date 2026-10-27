import { useEffect, useRef } from "react";
import { sendTrackingEvent, useTrackingAllowed } from "./pageViews";

// Records what visitors search for in the shop, and how many cards each
// search found, for the admin Overview ("What visitors search for"): the
// searches that found nothing show what people want that isn't in stock.
//
// The shop searches as you type, so a search is only recorded once it has
// settled: the results for it are on screen and the query hasn't changed
// for SETTLE_MS — or the visitor leaves the page first (a search that found
// nothing is often the last thing someone does). The same query isn't
// recorded twice in a row. Same rules as page views (pageViews.ts): never
// for staff, Do Not Track, Global Privacy Control or automated browsers, and
// nothing that looks like an email address or phone number is ever sent.

export const SETTLE_MS = 2000;

/** Trimmed, lower-cased and single-spaced, or null when it's too short or looks personal. */
export function searchToRecord(raw: string): string | null {
  const q = raw.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80).trim();
  if (q.length < 2) return null;
  if (q.includes("@") || /\d[\d\s().-]{6,}\d/.test(q)) return null;
  return q;
}

let lastRecorded: string | null = null;

/** For tests: forget the last recorded search. */
export function resetSearchTrackingForTests(): void {
  lastRecorded = null;
}

export function useSearchTracking({
  query,
  loading,
  results,
  filtered,
  deals,
}: {
  query: string;
  loading: boolean;
  /** How many cards the search found (the shop's total). */
  results: number;
  /** Shop filters are on (set, color, price…). */
  filtered: boolean;
  deals: boolean;
}): void {
  const allowed = useTrackingAllowed();
  const pending = useRef<{ event: Record<string, unknown>; key: string } | null>(null);

  // Send a settled search, once.
  const flush = useRef(() => {
    const p = pending.current;
    pending.current = null;
    if (!p || p.key === lastRecorded) return;
    lastRecorded = p.key;
    sendTrackingEvent(p.event);
  });

  useEffect(() => {
    // Only a search whose results are on screen counts; while the next
    // results load, the last one isn't settled any more.
    if (allowed !== true || loading) {
      pending.current = null;
      return;
    }
    const q = searchToRecord(query);
    if (!q) {
      pending.current = null;
      return;
    }
    pending.current = { key: q, event: { t: "s", q, n: results, f: filtered, d: deals } };
    const timer = window.setTimeout(() => flush.current(), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [allowed, loading, query, results, filtered, deals]);

  // Leaving the page (closing it, switching away) or the shop sends what's settled.
  useEffect(() => {
    const send = () => flush.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      send();
    };
  }, []);
}
