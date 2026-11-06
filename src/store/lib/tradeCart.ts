import { useEffect, useRef } from "react";
import { useCart } from "./CartContext";

// The old trade cart, retired: trading now starts from the normal shopping
// cart ("Use My Magic Cards" at checkout). A customer who picked cards with
// the old "Add to trade" still has them in this browser (localStorage,
// "gg-trade-cart"); they're moved into the shopping cart once, then the old
// list is removed, so nothing they picked is lost. The cart caps each line at
// what's in stock, as for any add.

const STORAGE_KEY = "gg-trade-cart";
/** The most lines moved (the old cart's own limit). */
const MAX_LINES = 200;

export interface LegacyTradeCartLine {
  inventoryItemId: string;
  quantity: number;
}

/** What the old trade cart held in this browser, then forgets it. Never throws. */
export function takeLegacyTradeCart(): LegacyTradeCartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    window.localStorage.removeItem(STORAGE_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((value): LegacyTradeCartLine[] => {
        const o = value as Record<string, unknown> | null;
        if (!o || typeof o.inventoryItemId !== "string" || typeof o.quantity !== "number") return [];
        const quantity = Math.floor(o.quantity);
        return quantity > 0 ? [{ inventoryItemId: o.inventoryItemId, quantity: Math.min(quantity, 99) }] : [];
      })
      .slice(0, MAX_LINES);
  } catch {
    return [];
  }
}

/** Moves an old trade cart into the shopping cart once the cart has loaded. Renders nothing. */
export function LegacyTradeCartMove() {
  const { loading, addItem } = useCart();
  const done = useRef(false);
  useEffect(() => {
    if (loading || done.current) return;
    done.current = true;
    const lines = takeLegacyTradeCart();
    if (lines.length === 0) return;
    void (async () => {
      for (const line of lines) {
        try {
          await addItem(line.inventoryItemId, line.quantity);
        } catch {
          // Sold or gone: the cart refuses it, as it would any add.
        }
      }
    })();
  }, [loading, addItem]);
  return null;
}
