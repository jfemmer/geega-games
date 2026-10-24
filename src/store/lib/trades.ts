// Trades confirmed in Admin → Trade Evaluator, as the customer's link page
// (/trade?t=…) and the admin see them. Shared by the browser and the server
// (api/trade.ts, api/admin/trades.ts). The numbers themselves come from
// src/admin/utils/tradeEvaluator.ts. Pure module: no React, browser or
// Supabase imports.

export const TRADE_PATH = "/trade";

/** The secret in a trade's link: URL-safe base64, as api/_lib/tokens.ts makes it. */
export const TRADE_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

/** One of the customer's cards: priced at TCG low. */
export interface TradeTheirCard {
  /** Null when staff didn't type a name. */
  name: string | null;
  quantity: number;
  tcgLowCents: number;
}

/** One of the shop's cards: at its regular website price when the trade was confirmed. */
export interface TradeYourCard {
  cardName: string;
  setName: string | null;
  setCode: string;
  collectorNumber: string;
  condition: string;
  finish: string;
  /** "Artist Proof" and the like; null for a regular copy. */
  variantType: string | null;
  quantity: number;
  priceCents: number;
}

/** A confirmed trade, as its customer sees it: no contact details, nothing about staff. */
export interface TradeView {
  tradeNumber: number;
  createdAt: string;
  customerName: string;
  creditPercent: number;
  theirCards: TradeTheirCard[];
  yourCards: TradeYourCard[];
  theirTcgLowCents: number;
  creditCents: number;
  yourCardsCents: number;
  /** Trade credit less the shop's cards: below zero the customer pays the rest. */
  balanceCents: number;
}

/** A confirmed trade, as staff see it. */
export interface StaffTradeView extends TradeView {
  id: string;
  /** The customer's link to the full breakdown. */
  link: string;
  customerPhone: string | null;
  customerEmail: string | null;
  confirmedByEmail: string | null;
  emailedTo: string | null;
  emailedAt: string | null;
  textedTo: string | null;
  textedAt: string | null;
}

/** How a customer-side line is named when staff didn't type one: "Card 3". */
export function theirCardLabel(card: TradeTheirCard, index: number): string {
  return card.name ?? `Card ${index + 1}`;
}

/** How a trade is priced, in the customer's words: on their link page and in the email. */
export const TRADE_PRICING_NOTE =
  "Your cards are priced at TCG low: the lowest current price for each card on TCGplayer. Our cards are at their regular price on our website; sale and deal prices don't apply to trades.";

/** The bottom line, from the customer's side. */
export function tradeBalanceLabel(balanceCents: number): string {
  if (balanceCents < 0) return "You pay";
  if (balanceCents > 0) return "Trade credit left for you";
  return "Even trade";
}
