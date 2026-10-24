// The trade evaluator (Admin → Trade Evaluator): a customer trades cards in
// for cards from the shop. Their cards are priced at TCG low, typed in by
// staff, and count at the trade credit percentage chosen for the trade. The
// shop's cards come from inventory at their regular website price: never a
// deal, storewide-sale or member price. What's left is what the customer
// pays, or the trade credit the shop owes them.
//
// Shared by the page and by api/admin/trades.ts, which works the numbers out
// again when a trade is confirmed. Plain TypeScript: no React, no I/O. Money
// is whole cents throughout.

export const DEFAULT_TRADE_CREDIT_PERCENT = 70;
export const TRADE_CREDIT_PRESETS = [50, 60, 70, 75, 80] as const;
export const MAX_TRADE_CREDIT_PERCENT = 150;
export const MAX_TRADE_QUANTITY = 999;
/** Lines per side of one trade. */
export const MAX_TRADE_LINES = 200;
export const MAX_CUSTOMER_NAME = 80;
export const MAX_CARD_NAME = 120;
/** $99,999.99: more than any single card's TCG low. */
export const MAX_TCG_LOW_CENTS = 9_999_999;

/** One of the customer's cards, as typed: any field may be blank. */
export interface TradeLineInput {
  name: string;
  quantity: string;
  price: string;
}

/** One of the shop's cards on a trade: its regular website price, and how many. */
export interface PricedLine {
  priceCents: number;
  quantity: number;
}

/**
 * A typed price in cents: "12.50", "$12.50", "12", "12.", ".5" or "1,200.00".
 * Null when it isn't a price (more than two decimals, letters, negative…).
 */
export function parsePriceCents(input: string): number | null {
  const match = /^\$?\s*(\d{0,7})(?:\.(\d{0,2}))?$/.exec(input.trim().replace(/,/g, ""));
  if (!match || (match[1] === "" && !match[2])) return null;
  return Number(match[1] || "0") * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** A typed quantity: blank is one card; otherwise a whole number up to MAX_TRADE_QUANTITY. */
export function parseQuantity(input: string): number | null {
  const text = input.trim();
  if (text === "") return 1;
  if (!/^\d{1,3}$/.test(text)) return null;
  const quantity = Number(text);
  return quantity <= MAX_TRADE_QUANTITY ? quantity : null;
}

/** "70" or "70%" as a whole trade credit percent from 1 to MAX_TRADE_CREDIT_PERCENT; null otherwise. */
export function parseCreditPercent(input: string): number | null {
  const match = /^\s*(\d{1,3})\s*%?\s*$/.exec(input);
  if (!match) return null;
  const percent = Number(match[1]);
  return percent >= 1 && percent <= MAX_TRADE_CREDIT_PERCENT ? percent : null;
}

/** Which of a line's fields hold something that isn't a number (a blank price is fine: not typed yet). */
export function lineErrors(line: TradeLineInput): { price: boolean; quantity: boolean } {
  return {
    price: line.price.trim() !== "" && parsePriceCents(line.price) === null,
    quantity: parseQuantity(line.quantity) === null,
  };
}

export type TradeLineStatus = "blank" | "counted" | "invalid";

/** Whether a line counts: blank (no price yet), counted, or not counted because a field isn't a number. */
export function lineStatus(line: TradeLineInput): TradeLineStatus {
  const errors = lineErrors(line);
  if (errors.price || errors.quantity) return "invalid";
  return line.price.trim() === "" ? "blank" : "counted";
}

export interface TradeSideTotal {
  /** TCG low of every counted line, times its quantity. */
  tcgLowCents: number;
  /** Cards counted (quantities added up). */
  cards: number;
  /** Lines left out because a price or quantity isn't a number. */
  invalidLines: number;
}

export function sideTotal(lines: TradeLineInput[]): TradeSideTotal {
  const total: TradeSideTotal = { tcgLowCents: 0, cards: 0, invalidLines: 0 };
  for (const line of lines) {
    const status = lineStatus(line);
    if (status === "invalid") total.invalidLines += 1;
    if (status !== "counted") continue;
    const quantity = parseQuantity(line.quantity)!;
    total.tcgLowCents += parsePriceCents(line.price)! * quantity;
    total.cards += quantity;
  }
  return total;
}

/** The customer's cards that count, as numbers: what a confirmed trade records. */
export function countedLines(lines: TradeLineInput[]): { name: string | null; quantity: number; tcgLowCents: number }[] {
  return lines.flatMap((line) =>
    lineStatus(line) === "counted" && parseQuantity(line.quantity)! > 0
      ? [{ name: line.name.trim() || null, quantity: parseQuantity(line.quantity)!, tcgLowCents: parsePriceCents(line.price)! }]
      : [],
  );
}

/**
 * A card's regular website price: what it's listed at before any discount.
 * A deal keeps its regular price in originalPriceCents; a storewide sale or a
 * member discount is never stored on the card at all.
 */
export function regularPriceCents(item: {
  priceCents: number | null;
  originalPriceCents?: number | null;
  isDeal?: boolean | null;
}): number | null {
  if (item.priceCents == null) return null;
  return item.isDeal && item.originalPriceCents != null ? item.originalPriceCents : item.priceCents;
}

export function pricedTotal(lines: PricedLine[]): { cents: number; cards: number } {
  let cents = 0;
  let cards = 0;
  for (const line of lines) {
    cents += line.priceCents * line.quantity;
    cards += line.quantity;
  }
  return { cents, cards };
}

/** What cards worth `tcgLowCents` at TCG low are worth in trade credit, to the cent. */
export function tradeCreditCents(tcgLowCents: number, percent: number): number {
  return Math.round((tcgLowCents * percent) / 100);
}

export type TradeOutcome = "empty" | "they_pay" | "credit_left" | "even";

export interface TradeTotals {
  /** Their cards at TCG low. */
  theirTcgLowCents: number;
  /** Their cards in trade credit. */
  creditCents: number;
  /** Your cards at their regular website price. */
  yourCents: number;
  /** Trade credit less your cards: below zero they pay the rest, above zero you owe them credit. */
  balanceCents: number;
  outcome: TradeOutcome;
  /**
   * They pay: TCG low of further cards they could trade in to cover it.
   * Credit left: website price of further cards of yours they could take with it.
   */
  makeEvenCents: number;
}

export function tradeTotals(theirTcgLowCents: number, yourCents: number, percent: number): TradeTotals {
  const creditCents = tradeCreditCents(theirTcgLowCents, percent);
  const balanceCents = creditCents - yourCents;
  const outcome: TradeOutcome =
    theirTcgLowCents === 0 && yourCents === 0
      ? "empty"
      : balanceCents < 0
        ? "they_pay"
        : balanceCents > 0
          ? "credit_left"
          : "even";
  const makeEvenCents =
    outcome === "they_pay" ? Math.ceil((-balanceCents * 100) / percent) : outcome === "credit_left" ? balanceCents : 0;
  return { theirTcgLowCents, creditCents, yourCents, balanceCents, outcome, makeEvenCents };
}

export interface TradeEvaluation extends TradeTotals {
  theirs: TradeSideTotal;
  yours: { cents: number; cards: number };
}

export function evaluateTrade(theirs: TradeLineInput[], yours: PricedLine[], percent: number): TradeEvaluation {
  const their = sideTotal(theirs);
  const your = pricedTotal(yours);
  return { ...tradeTotals(their.tcgLowCents, your.cents, percent), theirs: their, yours: your };
}

/** A phone number a text can go to: 7 to 15 digits, however it's written. */
export function isTextablePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/** Looks like an email address (the server checks it properly when it sends). */
export function isEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Opens the phone's messaging app with the message filled in. "?&body=" is
 * the form both iPhone and Android read.
 */
export function smsHref(phone: string, message: string): string {
  const number = phone.trim().startsWith("+") ? `+${phone.replace(/\D/g, "")}` : phone.replace(/\D/g, "");
  return `sms:${number}?&body=${encodeURIComponent(message)}`;
}

/** The text sent with a trade's link. */
export function tradeLinkMessage(trade: { customerName: string; tradeNumber: number; link: string }): string {
  const first = trade.customerName.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, here's the full breakdown of your trade with Geega Games (#${trade.tradeNumber}): ${trade.link}`;
}
