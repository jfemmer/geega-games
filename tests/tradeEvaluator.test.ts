import { describe, expect, it } from "vitest";
import {
  evaluateTrade,
  lineErrors,
  lineStatus,
  parseCreditPercent,
  parsePriceCents,
  parseQuantity,
  sideTotal,
  tradeCreditCents,
  type TradeLineInput,
} from "../src/admin/utils/tradeEvaluator";

// The trade evaluator's math: the customer's cards at the trade credit
// percentage of TCG low, the shop's cards at full TCG low, and what's left.

const card = (price: string, quantity = "1", name = ""): TradeLineInput => ({ name, quantity, price });

describe("reading what staff type", () => {
  it("reads prices the way they're usually typed", () => {
    expect(parsePriceCents("12.50")).toBe(1250);
    expect(parsePriceCents("$12.50")).toBe(1250);
    expect(parsePriceCents(" $ 3.99 ")).toBe(399);
    expect(parsePriceCents("12")).toBe(1200);
    expect(parsePriceCents("12.")).toBe(1200);
    expect(parsePriceCents(".5")).toBe(50);
    expect(parsePriceCents("0.07")).toBe(7);
    expect(parsePriceCents("1,200.00")).toBe(120000);
  });

  it("doesn't guess at anything that isn't a price", () => {
    for (const input of ["", ".", "$", "abc", "1.234", "-5", "12.5.0", "5 dollars"]) {
      expect(parsePriceCents(input), input).toBeNull();
    }
  });

  it("reads quantities, a blank one being a single card", () => {
    expect(parseQuantity("")).toBe(1);
    expect(parseQuantity(" 4 ")).toBe(4);
    expect(parseQuantity("0")).toBe(0);
    expect(parseQuantity("999")).toBe(999);
    expect(parseQuantity("1000")).toBeNull();
    expect(parseQuantity("2.5")).toBeNull();
    expect(parseQuantity("x")).toBeNull();
  });

  it("reads the trade credit as a whole percent from 1 to 150", () => {
    expect(parseCreditPercent("70")).toBe(70);
    expect(parseCreditPercent(" 75 % ")).toBe(75);
    expect(parseCreditPercent("150")).toBe(150);
    for (const input of ["", "0", "151", "70.5", "seventy"]) expect(parseCreditPercent(input), input).toBeNull();
  });
});

describe("adding up a side", () => {
  it("counts each card's TCG low times its quantity, skipping blank lines", () => {
    expect(sideTotal([card("50", "2"), card("20"), card(""), card("", "")])).toEqual({ tcgLowCents: 12000, cards: 3, invalidLines: 0 });
  });

  it("leaves out, and counts, lines with a price or quantity that isn't a number", () => {
    const lines = [card("abc"), card("5", "two"), card("", "x"), card("3")];
    expect(lines.map(lineStatus)).toEqual(["invalid", "invalid", "invalid", "counted"]);
    expect(lineErrors(lines[0])).toEqual({ price: true, quantity: false });
    expect(lineErrors(lines[1])).toEqual({ price: false, quantity: true });
    expect(sideTotal(lines)).toEqual({ tcgLowCents: 300, cards: 1, invalidLines: 3 });
  });

  it("rounds trade credit to the cent", () => {
    expect(tradeCreditCents(1234, 70)).toBe(864); // $8.638
    expect(tradeCreditCents(1235, 70)).toBe(865); // $8.645
    expect(tradeCreditCents(0, 70)).toBe(0);
  });
});

describe("evaluating a trade", () => {
  it("says what they pay, and how much more they'd need to trade in instead", () => {
    // $120 of their cards at 70% is $84 of credit, for $100 of yours.
    const trade = evaluateTrade([card("50", "2"), card("20")], [card("100")], 70);
    expect(trade).toMatchObject({ creditCents: 8400, balanceCents: -1600, outcome: "they_pay", makeEvenCents: 2286 });
    expect(trade.theirs.tcgLowCents).toBe(12000);
    expect(trade.yours.tcgLowCents).toBe(10000);
    // $22.86 more of their cards is $16.00 more credit.
    expect(tradeCreditCents(2286, 70)).toBe(1600);
  });

  it("says what credit they have left, and how much more of your cards it covers", () => {
    const trade = evaluateTrade([card("200")], [card("60"), card("40")], 70);
    expect(trade).toMatchObject({ creditCents: 14000, balanceCents: 4000, outcome: "credit_left", makeEvenCents: 4000 });
  });

  it("spots an even trade", () => {
    expect(evaluateTrade([card("100")], [card("80")], 80)).toMatchObject({ balanceCents: 0, outcome: "even", makeEvenCents: 0 });
  });

  it("handles one side being empty", () => {
    expect(evaluateTrade([], [card("10")], 70)).toMatchObject({ creditCents: 0, balanceCents: -1000, outcome: "they_pay", makeEvenCents: 1429 });
    expect(evaluateTrade([card("10")], [], 50)).toMatchObject({ creditCents: 500, outcome: "credit_left", makeEvenCents: 500 });
    expect(evaluateTrade([card("")], [card("")], 70)).toMatchObject({ outcome: "empty", balanceCents: 0 });
  });
});
