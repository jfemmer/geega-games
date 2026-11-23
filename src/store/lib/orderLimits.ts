// How many different cards one online order may have.
//
// The limit itself is a store setting (store_settings.max_order_lines), set
// on the admin Checkout Settings page and enforced by checkout_place_order_core
// in the database. The storefront reads it through store_ordering_status()
// (src/store/lib/storeStatus.ts) to warn in the cart before checkout.
//
// "Different cards" means cart lines (inventory items), not copies: four
// copies of one card count once.

/** The highest the setting can go (the database's check constraint). */
export const MAX_ORDER_LINES_CEILING = 1000;
/** The lowest it can go. */
export const MIN_ORDER_LINES = 1;
/** What the setting starts at, and what to assume if it can't be read. */
export const DEFAULT_MAX_ORDER_LINES = 500;

/** What the customer is told when their cart has more different cards than one order may. */
export function tooManyCardsMessage(lines: number, limit: number): string {
  const extra = Math.max(1, lines - limit);
  return `Orders can have up to ${limit.toLocaleString("en-US")} different cards, and your cart has ${lines.toLocaleString("en-US")}. Remove ${extra.toLocaleString("en-US")} of them, or check out in two orders.`;
}

/** The two numbers in the database's "too many items: 121 different cards, limit 100". */
export function parseTooManyItems(message: string): { lines: number; limit: number } | null {
  const m = /too many items: (\d+) different cards, limit (\d+)/i.exec(message);
  return m ? { lines: Number(m[1]), limit: Number(m[2]) } : null;
}

/** Is this a usable value for the setting? */
export function isValidOrderLineLimit(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= MIN_ORDER_LINES && n <= MAX_ORDER_LINES_CEILING;
}
