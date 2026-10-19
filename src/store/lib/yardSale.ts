// Yard Sale Mode, shared by the /yard-sale page, the admin and the server.
//
// At a yard sale, shoppers scan a QR code that opens /yard-sale on their
// phone, see our in-stock cards at or above the sale's minimum price with
// the yard sale discount, and send a pickup list with just their name. Staff
// grab the cards; the shopper pays in person (cash or Venmo, outside the
// website) together with whatever they bought from the tables, and staff tap
// Complete, which records the sale and takes the cards off the website.
// Online orders are paused while a sale is on. See
// supabase/migrations/20261019050000_yard_sale_mode.sql.
//
// Pure module (no React, browser or Supabase imports), so the server and the
// tests use it directly.

export const YARD_SALE_PATH = "/yard-sale";

export const YARD_SALE_LIMITS = {
  nameMax: 60,
  /** Different cards in one send (or one "add more"). */
  linesPerSend: 30,
  /** Different cards on one list. */
  linesPerList: 60,
  /** Copies of one card on a list. */
  copiesPerCard: 20,
  maxDiscountPercent: 90,
  maxMinPriceCents: 100_000,
  maxDays: 7,
} as const;

export const DEFAULT_YARD_SALE_MIN_PRICE_CENTS = 300;

/** How staff record a yard sale payment. Nothing is charged through the website. */
export type YardSalePaymentMethod = "cash" | "venmo";

export const YARD_SALE_PAYMENT_LABELS: Record<YardSalePaymentMethod, string> = {
  cash: "Cash",
  venmo: "Venmo",
};

/**
 * One card's yard sale price: the website price less the discount, rounded to
 * the nearest cent. Same formula as public.yard_sale_price, so what a shopper
 * sees is exactly what Complete charges.
 */
export function yardSalePriceCents(priceCents: number, discountPercent: number): number {
  return Math.floor((priceCents * (100 - discountPercent) + 50) / 100);
}

export interface YardSaleLine {
  /** The live website price of one copy. */
  priceCents: number;
  quantity: number;
}

export interface YardSaleTotals {
  /** At website prices. */
  subtotalCents: number;
  discountCents: number;
  /** At yard sale prices, before tax. */
  cardsCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * A list's totals, the way yard_sale_complete_list works them out: each card
 * at its yard sale price, then the register's sales tax (rounded down) on top.
 */
export function yardSaleTotals(lines: YardSaleLine[], discountPercent: number, taxBps = 0): YardSaleTotals {
  let subtotalCents = 0;
  let cardsCents = 0;
  for (const line of lines) {
    subtotalCents += line.priceCents * line.quantity;
    cardsCents += yardSalePriceCents(line.priceCents, discountPercent) * line.quantity;
  }
  const taxCents = Math.floor((cardsCents * taxBps) / 10_000);
  return {
    subtotalCents,
    discountCents: subtotalCents - cardsCents,
    cardsCents,
    taxCents,
    totalCents: cardsCents + taxCents,
  };
}

/** "$3" or "$3.50": a minimum price in a sentence ("cards $3 and up"). */
export function formatMinPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** "Cards $3 and up · 20% off" — the sale's terms in one line. */
export function yardSaleTermsLine(minPriceCents: number, discountPercent: number): string {
  const cards = minPriceCents > 0 ? `Cards ${formatMinPrice(minPriceCents)} and up` : "All our cards";
  return discountPercent > 0 ? `${cards} · ${discountPercent}% off` : cards;
}

/** Parses "20", "20%" or " 20 % " to a whole discount percent; null when it isn't one we allow. */
export function parseDiscountPercent(input: string): number | null {
  const match = /^\s*(\d{1,2})\s*%?\s*$/.exec(input);
  if (!match) return null;
  const value = Number(match[1]);
  return value <= YARD_SALE_LIMITS.maxDiscountPercent ? value : null;
}

/** Parses "3", "$3" or "3.50" to cents; null when it isn't a price we allow. */
export function parseMinPriceCents(input: string): number | null {
  const match = /^\s*\$?\s*(\d{1,4})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
  return cents <= YARD_SALE_LIMITS.maxMinPriceCents ? cents : null;
}

// ---------------------------------------------------------------------------
// A list as the shopper's phone sees it (/api/yard-sale)
// ---------------------------------------------------------------------------

export type YardSaleListStatus = "open" | "completed" | "cancelled";

export interface YardSaleListLine {
  /** pickup_request_items.id */
  itemId: string;
  inventoryItemId: string | null;
  cardName: string;
  setName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  condition: string;
  finish: string;
  imageUrl: string | null;
  quantity: number;
  /** Website price of one copy. */
  priceCents: number;
  /** Yard sale price of one copy. */
  salePriceCents: number;
}

export interface YardSaleListView {
  requestId: string;
  pickupNumber: number;
  customerName: string;
  status: YardSaleListStatus;
  /** Whether cards can still be added (the sale is on and the list is open). */
  canAdd: boolean;
  discountPercent: number;
  taxBps: number;
  lines: YardSaleListLine[];
  totals: YardSaleTotals;
}

/** What the phone keeps so it can show and add to its list after a reload. */
export interface YardSaleListAccess {
  requestId: string;
  token: string;
  saleId: string;
}
