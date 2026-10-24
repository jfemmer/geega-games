// The trade evaluator (Admin → Trade Evaluator): a customer trades cards in
// for cards from the shop. Both sides are priced at TCG low, typed in by
// staff; the customer's cards count at the trade credit percentage chosen
// for the trade, and the shop's cards at their full TCG low. What's left is
// what the customer pays, or the trade credit the shop owes them.
//
// Plain TypeScript: no React, no I/O. Money is whole cents throughout.

export const DEFAULT_TRADE_CREDIT_PERCENT = 70;
export const TRADE_CREDIT_PRESETS = [50, 60, 70, 75, 80] as const;
export const MAX_TRADE_CREDIT_PERCENT = 150;
export const MAX_TRADE_QUANTITY = 999;

/** One card on either side of a trade, as typed: any field may be blank. */
export interface TradeLineInput {
  name: string;
  quantity: string;
  price: string;
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

/** What cards worth `tcgLowCents` at TCG low are worth in trade credit, to the cent. */
export function tradeCreditCents(tcgLowCents: number, percent: number): number {
  return Math.round((tcgLowCents * percent) / 100);
}

export type TradeOutcome = "empty" | "they_pay" | "credit_left" | "even";

export interface TradeEvaluation {
  theirs: TradeSideTotal;
  yours: TradeSideTotal;
  /** Their cards in trade credit. */
  creditCents: number;
  /** Trade credit less your cards: below zero they pay the rest, above zero you owe them credit. */
  balanceCents: number;
  outcome: TradeOutcome;
  /**
   * They pay: TCG low of further cards they could trade in to cover it.
   * Credit left: TCG low of further cards of yours they could take with it.
   */
  makeEvenCents: number;
}

export function evaluateTrade(theirs: TradeLineInput[], yours: TradeLineInput[], percent: number): TradeEvaluation {
  const their = sideTotal(theirs);
  const your = sideTotal(yours);
  const creditCents = tradeCreditCents(their.tcgLowCents, percent);
  const balanceCents = creditCents - your.tcgLowCents;
  const outcome: TradeOutcome =
    their.tcgLowCents === 0 && your.tcgLowCents === 0
      ? "empty"
      : balanceCents < 0
        ? "they_pay"
        : balanceCents > 0
          ? "credit_left"
          : "even";
  const makeEvenCents =
    outcome === "they_pay" ? Math.ceil((-balanceCents * 100) / percent) : outcome === "credit_left" ? balanceCents : 0;
  return { theirs: their, yours: your, creditCents, balanceCents, outcome, makeEvenCents };
}
