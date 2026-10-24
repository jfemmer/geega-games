import { describe, expect, it } from "vitest";
import {
  countedLines,
  evaluateTrade,
  isEmailAddress,
  isTextablePhone,
  lineErrors,
  lineStatus,
  parseCreditPercent,
  parsePriceCents,
  parseQuantity,
  pricedTotal,
  regularPriceCents,
  sideTotal,
  smsHref,
  tradeCreditCents,
  tradeLinkMessage,
  tradeTotals,
  type PricedLine,
  type TradeLineInput,
} from "../src/admin/utils/tradeEvaluator";
import { theirCardLabel, tradeBalanceLabel } from "../src/store/lib/trades";

// The trade evaluator's math: the customer's cards at the trade credit
// percentage of TCG low, the shop's cards at their regular website price,
// and what's left. Plus sending the customer the link.

const card = (price: string, quantity = "1", name = ""): TradeLineInput => ({ name, quantity, price });
const ours = (priceCents: number, quantity = 1): PricedLine => ({ priceCents, quantity });

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

describe("adding up their cards", () => {
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

  it("turns the counted lines into what a confirmed trade records", () => {
    expect(countedLines([card("3.50", "2", " Sol Ring "), card(""), card("abc"), card("1", "0"), card("12", "", "")])).toEqual([
      { name: "Sol Ring", quantity: 2, tcgLowCents: 350 },
      { name: null, quantity: 1, tcgLowCents: 1200 },
    ]);
  });
});

describe("pricing your cards", () => {
  it("uses the regular website price: a deal's price before the discount", () => {
    expect(regularPriceCents({ priceCents: 800, originalPriceCents: 1000, isDeal: true })).toBe(1000);
    expect(regularPriceCents({ priceCents: 1000, originalPriceCents: null, isDeal: false })).toBe(1000);
    // A card that's no longer on deal is at its listed price, whatever was kept from the deal.
    expect(regularPriceCents({ priceCents: 1000, originalPriceCents: 1500, isDeal: false })).toBe(1000);
    // On deal with no price kept from before it: the listed price is all there is.
    expect(regularPriceCents({ priceCents: 800, originalPriceCents: null, isDeal: true })).toBe(800);
    expect(regularPriceCents({ priceCents: null, originalPriceCents: 1000, isDeal: true })).toBeNull();
  });

  it("adds up each card's price times how many", () => {
    expect(pricedTotal([ours(250, 2), ours(1000)])).toEqual({ cents: 1500, cards: 3 });
    expect(pricedTotal([])).toEqual({ cents: 0, cards: 0 });
  });
});

describe("evaluating a trade", () => {
  it("says what they pay, and how much more they'd need to trade in instead", () => {
    // $120 of their cards at 70% is $84 of credit, for $100 of yours.
    const trade = evaluateTrade([card("50", "2"), card("20")], [ours(10000)], 70);
    expect(trade).toMatchObject({ creditCents: 8400, yourCents: 10000, balanceCents: -1600, outcome: "they_pay", makeEvenCents: 2286 });
    expect(trade.theirs.tcgLowCents).toBe(12000);
    expect(trade.yours).toEqual({ cents: 10000, cards: 1 });
    // $22.86 more of their cards is $16.00 more credit.
    expect(tradeCreditCents(2286, 70)).toBe(1600);
  });

  it("says what credit they have left, and how much more of your cards it covers", () => {
    const trade = evaluateTrade([card("200")], [ours(6000), ours(2000, 2)], 70);
    expect(trade).toMatchObject({ creditCents: 14000, balanceCents: 4000, outcome: "credit_left", makeEvenCents: 4000 });
  });

  it("spots an even trade", () => {
    expect(evaluateTrade([card("100")], [ours(8000)], 80)).toMatchObject({ balanceCents: 0, outcome: "even", makeEvenCents: 0 });
  });

  it("handles one side being empty", () => {
    expect(evaluateTrade([], [ours(1000)], 70)).toMatchObject({ creditCents: 0, balanceCents: -1000, outcome: "they_pay", makeEvenCents: 1429 });
    expect(evaluateTrade([card("10")], [], 50)).toMatchObject({ creditCents: 500, outcome: "credit_left", makeEvenCents: 500 });
    expect(evaluateTrade([card("")], [], 70)).toMatchObject({ outcome: "empty", balanceCents: 0 });
  });

  it("works the same from totals alone, as the server does", () => {
    expect(tradeTotals(12000, 10000, 70)).toEqual({
      theirTcgLowCents: 12000,
      creditCents: 8400,
      yourCents: 10000,
      balanceCents: -1600,
      outcome: "they_pay",
      makeEvenCents: 2286,
    });
  });
});

describe("sending the customer their link", () => {
  it("knows a phone number a text can go to, however it's written", () => {
    for (const phone of ["314-555-0100", "(314) 555-0100", "+1 314 555 0100", "5550100"]) expect(isTextablePhone(phone), phone).toBe(true);
    for (const phone of ["", "555", "call me", "1234567890123456"]) expect(isTextablePhone(phone), phone).toBe(false);
  });

  it("knows what looks like an email address", () => {
    expect(isEmailAddress(" sam@example.com ")).toBe(true);
    for (const email of ["", "sam", "sam@", "sam@example", "sam @example.com"]) expect(isEmailAddress(email), email).toBe(false);
  });

  it("opens the phone's messages with the number and the text filled in", () => {
    const message = "Hi Sam, here's the full breakdown of your trade with Geega Games (#1001): https://geega-games.com/trade?t=abc";
    expect(smsHref("(314) 555-0100", message)).toBe(`sms:3145550100?&body=${encodeURIComponent(message)}`);
    expect(smsHref("+1 314 555 0100", "Hi")).toBe("sms:+13145550100?&body=Hi");
  });

  it("writes the text with their first name and the trade number", () => {
    expect(tradeLinkMessage({ customerName: "  Sam Rivera ", tradeNumber: 1001, link: "https://geega-games.com/trade?t=abc" })).toBe(
      "Hi Sam, here's the full breakdown of your trade with Geega Games (#1001): https://geega-games.com/trade?t=abc",
    );
  });

  it("names the bottom line from the customer's side", () => {
    expect(tradeBalanceLabel(-1240)).toBe("You pay");
    expect(tradeBalanceLabel(500)).toBe("Trade credit left for you");
    expect(tradeBalanceLabel(0)).toBe("Even trade");
    expect(theirCardLabel({ name: null, quantity: 1, tcgLowCents: 100 }, 2)).toBe("Card 3");
    expect(theirCardLabel({ name: "Sol Ring", quantity: 1, tcgLowCents: 100 }, 0)).toBe("Sol Ring");
  });
});
