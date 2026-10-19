import { describe, expect, it } from "vitest";
import {
  SORTING_SHIPPING_NOTICE,
  SORTING_SHIPPING_TERMS,
  checkQuoteItems,
  formatUsdCents,
  parseCardCount,
  parseDollarsToCents,
  sortingBalanceDueCents,
  sortingEstimateCents,
  sortingQuoteLines,
  sortingQuoteTotalCents,
  sortingStatusLabel,
} from "../src/store/lib/sortingService";

// Collection sorting's shared rules: the owner's policy wording (word for
// word), the per-1,000-card estimate, and the quote arithmetic the admin, the
// API and the database all agree on.

describe("the shipping policy wording", () => {
  it("is the owner's text, word for word", () => {
    expect(SORTING_SHIPPING_NOTICE).toBe(
      "Shipping your collection to us? Customers are responsible for all packaging supplies and shipping costs to Geega Games. Return shipping and necessary packaging costs will be calculated and included in your final quoted price, so you'll know the complete cost before approving your service.",
    );
    expect(SORTING_SHIPPING_TERMS).toBe(
      "I understand that I am responsible for shipping my cards to Geega Games, including packing supplies and shipping charges. I also understand that return shipping and packaging costs will be included in my final service quote.",
    );
  });
});

describe("the sorting estimate", () => {
  it("is pro-rated per 1,000 cards and rounded to the cent", () => {
    expect(sortingEstimateCents(2000, 2500)).toBe(5000); // $20.00/1,000 × 2,500 = $50.00
    expect(sortingEstimateCents(1999, 1)).toBe(2); // 1.999¢ → 2¢
    expect(sortingEstimateCents(1500, 333)).toBe(500); // 499.5¢ → 500¢
  });

  it("is zero without a rate or cards", () => {
    expect(sortingEstimateCents(0, 1000)).toBe(0);
    expect(sortingEstimateCents(2000, 0)).toBe(0);
    expect(sortingEstimateCents(Number.NaN, 10)).toBe(0);
  });
});

describe("reading what staff and customers type", () => {
  it("reads card counts with or without commas", () => {
    expect(parseCardCount("12,000")).toBe(12000);
    expect(parseCardCount(" 12 000 ")).toBe(12000);
    expect(parseCardCount("12.5")).toBeNull();
    expect(parseCardCount("-4")).toBeNull();
    expect(parseCardCount("")).toBeNull();
  });

  it("reads dollar amounts to cents", () => {
    expect(parseDollarsToCents("12.50")).toBe(1250);
    expect(parseDollarsToCents("$1,012.5")).toBe(101250);
    expect(parseDollarsToCents("")).toBe(0);
    expect(parseDollarsToCents("12.345")).toBeNull();
    expect(parseDollarsToCents("-3")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });
});

describe("quotes", () => {
  const items = {
    sortingServiceCents: 6000,
    returnShippingCents: 1850,
    returnPackagingCents: 400,
    otherCharges: [{ label: "Rush", amountCents: 500 }],
  };

  it("total the sum of their items", () => {
    expect(sortingQuoteTotalCents(items)).toBe(8750);
  });

  it("are checked like the database checks them", () => {
    expect(checkQuoteItems(items)).toEqual({ ok: true, items });
    expect(checkQuoteItems({ ...items, otherCharges: [{ label: "  Rush ", amountCents: 500 }] })).toEqual({
      ok: true,
      items,
    });
    expect(checkQuoteItems({ ...items, returnShippingCents: -1 })).toMatchObject({ ok: false });
    expect(checkQuoteItems({ ...items, sortingServiceCents: 1.5 })).toMatchObject({ ok: false });
    expect(checkQuoteItems({ ...items, otherCharges: [{ label: "", amountCents: 5 }] })).toMatchObject({ ok: false });
    expect(
      checkQuoteItems({ ...items, otherCharges: Array.from({ length: 6 }, () => ({ label: "x", amountCents: 1 })) }),
    ).toMatchObject({ ok: false });
    expect(checkQuoteItems(null)).toMatchObject({ ok: false });
  });

  it("always show return shipping and packaging for a shipped collection, even at $0", () => {
    const lines = sortingQuoteLines({ ...items, returnShippingCents: 0, countedCards: 3200 }, "ship");
    expect(lines.map((l) => [l.label, l.amountCents])).toEqual([
      ["Sorting service (3,200 cards)", 6000],
      ["Return shipping", 0],
      ["Return packaging & supplies", 400],
      ["Rush", 500],
    ]);
  });

  it("leave return shipping off a drop-off unless it was charged", () => {
    const lines = sortingQuoteLines({ ...items, returnShippingCents: 0, returnPackagingCents: 0 }, "drop_off");
    expect(lines.map((l) => l.label)).toEqual(["Sorting service", "Rush"]);
  });
});

describe("payments and labels", () => {
  it("never owe a negative balance", () => {
    expect(sortingBalanceDueCents(8750, 2500)).toBe(6250);
    expect(sortingBalanceDueCents(8750, 9000)).toBe(0);
    expect(sortingBalanceDueCents(null, 0)).toBe(0);
  });

  it("formats dollars", () => {
    expect(formatUsdCents(123456)).toBe("$1,234.56");
    expect(formatUsdCents(5)).toBe("$0.05");
  });

  it("words statuses for how the cards travel", () => {
    expect(sortingStatusLabel("ready", "drop_off")).toBe("Ready for pickup");
    expect(sortingStatusLabel("ready", "ship")).toBe("Sorted — getting ready to ship back");
    expect(sortingStatusLabel("returned", "ship")).toBe("Shipped back");
    expect(sortingStatusLabel("awaiting_cards", "drop_off")).toBe("Waiting for your drop-off");
  });
});
