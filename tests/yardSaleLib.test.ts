import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatMinPrice,
  parseDiscountPercent,
  parseMinPriceCents,
  yardSalePriceCents,
  yardSaleTermsLine,
  yardSaleTotals,
} from "../src/store/lib/yardSale";
import { formatReopenDate, formatReopenShort } from "../src/store/lib/storeStatus";
import { yardSaleFlyerCopy } from "../src/admin/utils/marketing";

// The yard sale's prices are worked out in two places: the database (what
// Complete records) and the browser (what the shopper and staff see). They
// must agree to the cent.

const migration = readFileSync(new URL("../supabase/migrations/20261019050000_yard_sale_mode.sql", import.meta.url), "utf8");

describe("yard sale prices", () => {
  it("rounds each card to the nearest cent, half up", () => {
    expect(yardSalePriceCents(500, 20)).toBe(400);
    expect(yardSalePriceCents(1234, 20)).toBe(987); // 987.2
    expect(yardSalePriceCents(1235, 20)).toBe(988); // 988.0
    expect(yardSalePriceCents(1, 50)).toBe(1); // 0.5 -> 1
    expect(yardSalePriceCents(999, 0)).toBe(999);
    expect(yardSalePriceCents(333, 90)).toBe(33); // 33.3
  });

  it("uses the same formula as the database", () => {
    expect(migration).toContain("((p_price_cents::bigint * (100 - p_discount_percent) + 50) / 100)::integer");
    expect(migration).toContain("public.yard_sale_price(v_price, v_sale.discount_percent) * ri.quantity");
    expect(migration).toContain("v_tax := ((v_discounted::bigint * v_tax_bps) / 10000)::integer;");
  });

  it("starts from the price the website shows, a storewide sale included", () => {
    // What the yard sale page lists (search_inventory's price), what a list
    // holds and shows, and what Complete charges are all this one price.
    const effective = "public.storefront_effective_price(v_inv.price_cents, v_inv.original_price_cents, v_inv.is_deal)";
    expect(migration.split(`v_price := ${effective};`).length - 1).toBe(2); // holding a card, and Complete
    expect(migration).toContain("public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal)"); // inventory_live_prices
    expect(migration).not.toMatch(/v_inv\.price_cents\s*[<*]/);
  });

  it("totals a list card by card, then adds tax rounded down", () => {
    const totals = yardSaleTotals(
      [
        { priceCents: 500, quantity: 2 },
        { priceCents: 1234, quantity: 1 },
      ],
      20,
      825,
    );
    expect(totals).toEqual({ subtotalCents: 2234, discountCents: 447, cardsCents: 1787, taxCents: 147, totalCents: 1934 });
    expect(yardSaleTotals([], 20)).toEqual({ subtotalCents: 0, discountCents: 0, cardsCents: 0, taxCents: 0, totalCents: 0 });
  });
});

describe("the sale's terms, in words", () => {
  it("says the minimum and the discount", () => {
    expect(formatMinPrice(300)).toBe("$3");
    expect(formatMinPrice(350)).toBe("$3.50");
    expect(yardSaleTermsLine(300, 20)).toBe("Cards $3 and up · 20% off");
    expect(yardSaleTermsLine(300, 0)).toBe("Cards $3 and up");
    expect(yardSaleTermsLine(0, 10)).toBe("All our cards · 10% off");
  });

  it("puts the minimum on the QR sign", () => {
    expect(yardSaleFlyerCopy(300).sub).toBe("Scan to see our cards $3 and up — we'll grab them for you.");
    expect(yardSaleFlyerCopy(0).sub).toBe("Scan to see all our cards — we'll grab them for you.");
    expect(yardSaleFlyerCopy().headline).toBe("Looking for something better?");
    // The table sign prints only the headline and the call to action.
    expect(yardSaleFlyerCopy(300).cta).toBe("Scan to see our cards $3 and up");
    expect(yardSaleFlyerCopy(350).cta).toBe("Scan to see our cards $3.50 and up");
    expect(yardSaleFlyerCopy(0).cta).toBe("Scan to see all our cards");
  });

  it("reads the admin's discount and minimum price", () => {
    expect(parseDiscountPercent("20")).toBe(20);
    expect(parseDiscountPercent(" 25 % ")).toBe(25);
    expect(parseDiscountPercent("0")).toBe(0);
    expect(parseDiscountPercent("95")).toBeNull();
    expect(parseDiscountPercent("12.5")).toBeNull();
    expect(parseDiscountPercent("")).toBeNull();
    expect(parseMinPriceCents("3")).toBe(300);
    expect(parseMinPriceCents("$3.5")).toBe(350);
    expect(parseMinPriceCents("3.50")).toBe(350);
    expect(parseMinPriceCents("0")).toBe(0);
    expect(parseMinPriceCents("1001")).toBeNull();
    expect(parseMinPriceCents("three")).toBeNull();
  });
});

describe("when checkout reopens", () => {
  const now = new Date(2026, 9, 24, 10, 0); // Sat Oct 24, 10:00
  it("gives the time when it's today or tomorrow", () => {
    const today = new Date(2026, 9, 24, 15, 0).toISOString();
    const tomorrow = new Date(2026, 9, 25, 9, 30).toISOString();
    const later = new Date(2026, 9, 28, 12, 0).toISOString();
    expect(formatReopenDate(today, now)).toMatch(/^today at 3:00\sPM$/);
    expect(formatReopenDate(tomorrow, now)).toMatch(/^tomorrow at 9:30\sAM$/);
    expect(formatReopenDate(later, now)).toBe("Wednesday, October 28");
    expect(formatReopenShort(today, now)).toMatch(/^at 3:00\sPM$/);
    expect(formatReopenShort(tomorrow, now)).toBe("tomorrow");
    expect(formatReopenShort(later, now)).toBe("Wed, Oct 28");
  });
});
