import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "../../supabase";

// Vacation mode, as seen by the storefront. One shared snapshot for every
// component (banner, cart drawer, checkout), refreshed every minute and when
// the tab regains focus, so turning vacation mode on or off in the admin
// reaches open tabs without a reload.
//
// This only drives the UI. The rule itself is enforced server-side by
// checkout_create_order, so a stale snapshot can't let an order through.

export type StoreStatus = {
  ordersPaused: boolean;
  message: string;
  /** When ordering reopens by itself, if a date was set. */
  pausedUntil: string | null;
};

const OPEN: StoreStatus = { ordersPaused: false, message: "", pausedUntil: null };
const REFRESH_MS = 60_000;

let snapshot: StoreStatus = OPEN;
let reopenTimer: number | undefined;
const listeners = new Set<() => void>();

function publish(next: StoreStatus) {
  snapshot = next;
  listeners.forEach((l) => l());
  // Reopen on time in open tabs instead of waiting for the next refresh.
  window.clearTimeout(reopenTimer);
  if (next.ordersPaused && next.pausedUntil) {
    const ms = new Date(next.pausedUntil).getTime() - Date.now();
    if (ms > 0 && ms < 2 ** 31 - 1) reopenTimer = window.setTimeout(() => void refreshStoreStatus(), ms + 1000);
  }
}

export async function refreshStoreStatus(): Promise<StoreStatus> {
  const { data, error } = await supabase.rpc("store_ordering_status");
  // On a failed read keep the last known state; checkout is still protected
  // by the server either way.
  if (error) return snapshot;
  const row = Array.isArray(data) ? data[0] : null;
  publish(
    row?.paused
      ? { ordersPaused: true, message: row.message, pausedUntil: row.paused_until ?? null }
      : OPEN,
  );
  return snapshot;
}

let started = false;
function start() {
  if (started) return;
  started = true;
  void refreshStoreStatus();
  window.setInterval(() => void refreshStoreStatus(), REFRESH_MS);
  window.addEventListener("focus", () => void refreshStoreStatus());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStoreStatus(): StoreStatus {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => OPEN);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * When checkout reopens, as customers see it: "today at 3:00 PM" or
 * "tomorrow at 9:00 AM" when it's that soon (a yard sale ends the same day),
 * otherwise "Monday, October 6".
 */
export function formatReopenDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, now)) return `today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, tomorrow)) return `tomorrow at ${time}`;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** The short form for the one-line banner: "at 3:00 PM", "tomorrow" or "Sat, Oct 3". */
export function formatReopenShort(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (sameDay(date, now)) return `at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, tomorrow)) return "tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
