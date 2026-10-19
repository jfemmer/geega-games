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
const wholeDollars = readFileSync(
  new URL("../supabase/migrations/20261019190000_yard_sale_whole_dollars_deck_search.sql", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("yard sale prices", () => {
  it("rounds each card to the nearest dollar after the discount", () => {
    expect(yardSalePriceCents(500, 20)).toBe(400); // $4.00
    expect(yardSalePriceCents(1234, 20)).toBe(1000); // $9.87 -> $10
    expect(yardSalePriceCents(1185, 20)).toBe(900); // $9.48 -> $9
    expect(yardSalePriceCents(1188, 20)).toBe(1000); // $9.504 -> $10
    expect(yardSalePriceCents(500, 10)).toBe(500); // $4.50: 50 cents rounds up
    expect(yardSalePriceCents(2899, 20)).toBe(2300); // $23.19 -> $23
    expect(yardSalePriceCents(6499, 20)).toBe(5200); // $51.99 -> $52
  });

  it("never goes above the website price or under $1", () => {
    expect(yardSalePriceCents(480, 5)).toBe(400); // $4.56 would round up to $5, more than $4.80: $4
    expect(yardSalePriceCents(438, 0)).toBe(400); // no discount: down to the whole dollar
    expect(yardSalePriceCents(1250, 0)).toBe(1200);
    expect(yardSalePriceCents(500, 0)).toBe(500);
    expect(yardSalePriceCents(300, 90)).toBe(100); // $0.30 -> $1, never free
    expect(yardSalePriceCents(100, 90)).toBe(100);
    expect(yardSalePriceCents(75, 50)).toBe(75); // under $1: its website price
  });

  it("uses the same formula as the database", () => {
    expect(wholeDollars).toContain("v_price := (((p_price_cents::bigint * (100 - p_discount_percent) + 5000) / 10000) * 100)::integer;");
    expect(wholeDollars).toContain("v_price := (p_price_cents / 100) * 100;");
    expect(wholeDollars).toContain("return greatest(v_price, 100);");
    expect(wholeDollars).toContain("if p_price_cents < 100 then\n    return p_price_cents;");
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
    // $4 x 2 + $10 = $18; 8.25% tax is $1.485 -> $1.48.
    expect(totals).toEqual({ subtotalCents: 2234, discountCents: 434, cardsCents: 1800, taxCents: 148, totalCents: 1948 });
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
