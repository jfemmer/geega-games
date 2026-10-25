import { useSyncExternalStore } from "react";
import { TRADE_LIMITS } from "./tradeCenter";

// The trade cart: cards from our inventory a customer wants to trade toward,
// picked with "Add to trade" on card pages before a trade starts (or to add
// to a trade they're still building). It lives in this browser only
// (localStorage) and holds nothing: our cards are held, and priced, only
// when a trade starts or changes (the server reads inventory then). Shared
// across tabs through the storage event.

export interface TradeCartItem {
  inventoryItemId: string;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  condition: string;
  finish: string;
  imageUrl: string | null;
  quantity: number;
  /** How many were for sale when it was added (the server checks again). */
  maxQuantity: number;
  /** The trade price shown when it was added: the regular price (deals don't apply). */
  tradePriceCents: number;
  /** The card page, to go back to it. */
  cardPath: string | null;
}

const STORAGE_KEY = "gg-trade-cart";
/** Lines kept: the most a trade can have (the server enforces the configured limit). */
const MAX_LINES = 200;

const listeners = new Set<() => void>();
let cache: TradeCartItem[] | null = null;
const EMPTY: TradeCartItem[] = [];

function isItem(value: unknown): value is TradeCartItem {
  const o = value as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o.inventoryItemId === "string" &&
    typeof o.cardName === "string" &&
    typeof o.quantity === "number" &&
    typeof o.tradePriceCents === "number"
  );
}

function read(): TradeCartItem[] {
  if (cache) return cache;
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isItem).slice(0, MAX_LINES) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: TradeCartItem[]): void {
  cache = items;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* private mode or storage full: the cart still works for this page */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function clampQuantity(quantity: number, max: number): number {
  return Math.max(1, Math.min(Math.floor(quantity), Math.max(max, 1), TRADE_LIMITS.maxQuantity));
}

export const tradeCart = {
  items: read,
  /** Adds one more copy (or the given number), up to how many are for sale. */
  add(item: Omit<TradeCartItem, "quantity"> & { quantity?: number }): void {
    const items = read();
    const existing = items.find((i) => i.inventoryItemId === item.inventoryItemId);
    if (existing) {
      write(
        items.map((i) =>
          i.inventoryItemId === item.inventoryItemId
            ? { ...i, ...item, quantity: clampQuantity(i.quantity + (item.quantity ?? 1), item.maxQuantity) }
            : i,
        ),
      );
      return;
    }
    if (items.length >= MAX_LINES) return;
    write([...items, { ...item, quantity: clampQuantity(item.quantity ?? 1, item.maxQuantity) }]);
  },
  setQuantity(inventoryItemId: string, quantity: number): void {
    write(read().map((i) => (i.inventoryItemId === inventoryItemId ? { ...i, quantity: clampQuantity(quantity, i.maxQuantity) } : i)));
  },
  remove(inventoryItemId: string): void {
    write(read().filter((i) => i.inventoryItemId !== inventoryItemId));
  },
  clear(): void {
    write([]);
  },
};

/** The trade cart, for components. Empty in the prerendered page. */
export function useTradeCart(): TradeCartItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function tradeCartCount(items: TradeCartItem[]): number {
  return items.reduce((n, i) => n + i.quantity, 0);
}

export function tradeCartTotalCents(items: TradeCartItem[]): number {
  return items.reduce((n, i) => n + i.quantity * i.tradePriceCents, 0);
}

/** For tests: forget what's cached in memory. */
export function resetTradeCartForTests(): void {
  cache = null;
}
