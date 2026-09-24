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

/** "Monday, October 6" — the reopen date as customers see it. */
export function formatReopenDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
