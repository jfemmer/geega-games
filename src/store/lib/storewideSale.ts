import { useEffect, useRef, useSyncExternalStore } from "react";
import { supabase } from "../../supabase";

// The storewide sale (Admin → Storewide Sale), as the storefront sees it. One
// shared snapshot for the banner, the cart and checkout, refreshed every 30
// seconds while the page is in view, as soon as the tab comes back into view,
// and just after the sale ends. So a sale starting, ending or changing reaches
// open tabs without a reload: every view showing prices re-reads them then
// (useOnSalePriceChange) — the cart, the shop, deals, set and kiosk grids, card
// pages, Shop Picks and the deck pages.
//
// Display only. The database applies the sale to every price by itself
// (storefront_effective_price: the catalog, cart_item_availability and the
// checkout total), only while the sale is running, so a stale snapshot can
// never change what a customer pays.

export type StorewideSale = {
  id: string;
  name: string;
  discountPercent: number;
  startsAt: string;
  endsAt: string;
};

export type StorewideSaleState = {
  /** The sale running now, or null. */
  sale: StorewideSale | null;
  /**
   * False until the first answer arrives, so "no sale" is never confused
   * with "haven't asked yet" (the cart re-prices only on a real change).
   */
  known: boolean;
};

const UNKNOWN: StorewideSaleState = { sale: null, known: false };
const REFRESH_MS = 30_000;
/** setTimeout's ceiling; a sale ending further out than ~24 days is re-checked by the poll. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

let snapshot: StorewideSaleState = UNKNOWN;
/**
 * Goes up by one each time the sale's effect on prices changes (it starts,
 * ends, is replaced or its % is edited) after the page first learned about it.
 * The first answer isn't a change: whatever loaded before it already had the
 * database's current prices.
 */
let priceVersion = 0;
let endTimer: number | undefined;
let inFlight: Promise<StorewideSaleState> | null = null;
const listeners = new Set<() => void>();

function sameSale(a: StorewideSale | null, b: StorewideSale | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.discountPercent === b.discountPercent &&
    a.startsAt === b.startsAt &&
    a.endsAt === b.endsAt
  );
}

/**
 * Changes exactly when the sale's effect on prices changes: it starts, ends,
 * is replaced, or its percentage is edited. For effects to depend on.
 */
export function storewideSaleKey(sale: StorewideSale | null): string {
  return sale ? `${sale.id}:${sale.discountPercent}` : "none";
}

// Ask the server again a second after the sale ends, so open tabs drop it on
// time instead of up to 30 seconds late. If this device's clock runs ahead of
// the server's, the server still has the sale at that moment: look again
// shortly. A clock that's more than a minute off is left to the regular poll.
function scheduleEndCheck(sale: StorewideSale | null) {
  window.clearTimeout(endTimer);
  endTimer = undefined;
  if (!sale) return;
  const msLeft = new Date(sale.endsAt).getTime() - Date.now();
  const wait = msLeft > 0 ? msLeft + 1000 : msLeft > -60_000 ? 5000 : null;
  if (wait != null && wait < MAX_TIMEOUT_MS) {
    endTimer = window.setTimeout(() => void refreshStorewideSale(), wait);
  }
}

function publish(sale: StorewideSale | null) {
  scheduleEndCheck(sale);
  // Nothing changed: keep the same snapshot so nothing re-renders.
  if (snapshot.known && sameSale(sale, snapshot.sale)) return;
  if (snapshot.known && storewideSaleKey(sale) !== storewideSaleKey(snapshot.sale)) priceVersion += 1;
  snapshot = { sale, known: true };
  listeners.forEach((l) => l());
}

function parseSale(data: unknown): StorewideSale | null {
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.discount_percent !== "number" ||
    typeof row.ends_at !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    name: typeof row.name === "string" && row.name.trim() ? row.name : "Storewide Sale",
    discountPercent: row.discount_percent,
    startsAt: typeof row.starts_at === "string" ? row.starts_at : "",
    endsAt: row.ends_at,
  };
}

/**
 * Reads the current sale from the database and shares it. Calls made while a
 * read is already under way share that read. On a failed read the last known
 * state is kept.
 */
export function refreshStorewideSale(): Promise<StorewideSaleState> {
  // .finally runs after the assignment even if the read fails at once.
  inFlight ??= readSale().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function readSale(): Promise<StorewideSaleState> {
  try {
    const { data, error } = await supabase.rpc("current_storewide_sale");
    if (!error) publish(parseSale(data));
  } catch {
    /* offline or similar: keep what we had */
  }
  return snapshot;
}

let started = false;
function start() {
  if (started) return;
  started = true;
  void refreshStorewideSale();
  // A hidden tab isn't polled; it catches up the moment it's back in view.
  window.setInterval(() => {
    if (document.visibilityState !== "hidden") void refreshStorewideSale();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshStorewideSale();
  });
  window.addEventListener("focus", () => void refreshStorewideSale());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStorewideSale(): StorewideSaleState {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => UNKNOWN);
}

/**
 * Calls `onChange` whenever the storewide sale's effect on prices changes
 * while the component is mounted: the sale starts, ends, is replaced or its %
 * is edited. Not on mount, and not when the page first learns about the sale.
 * For anything showing prices to re-read them, quietly (keep what's on screen
 * until the new prices arrive).
 */
export function useOnSalePriceChange(onChange: () => void): void {
  useEffect(start, []);
  const version = useSyncExternalStore(subscribe, () => priceVersion, () => 0);
  const seen = useRef(version);
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    if (version === seen.current) return;
    seen.current = version;
    latest.current();
  }, [version]);
}
