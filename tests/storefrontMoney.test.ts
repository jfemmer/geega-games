import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  SHIPPING,
  shippingCents,
  previewOrderTotals,
  amountUntilFreeShipping,
  effectiveShippingMethod,
  qualifiesForFreeShipping,
  formatCents,
  formatCentsShort,
  formatShipping,
  orderShippingText,
} from "../src/store/lib/money";
import {
  addLine,
  setLineQuantity,
  removeLine,
  planCartMerge,
  type GuestCartLine,
} from "../src/store/lib/guestCart";

describe("shipping math mirrors checkout_place_order_core", () => {
  const FREE = SHIPPING.freeShippingThresholdCents;

  it("ships free from $75", () => {
    expect(FREE).toBe(7500);
    expect(qualifiesForFreeShipping(7499)).toBe(false);
    expect(qualifiesForFreeShipping(7500)).toBe(true);
  });

  it("charges the usual rates below the free shipping threshold", () => {
    expect(shippingCents("tracked", 100)).toBe(SHIPPING.trackedCents);
    expect(shippingCents("tracked", FREE - 1)).toBe(SHIPPING.trackedCents);
    expect(shippingCents("pwe", 100)).toBe(SHIPPING.pweCents);
    expect(shippingCents("pwe", FREE - 1)).toBe(SHIPPING.pweCents);
  });

  it("is free at/above the threshold, whatever was picked", () => {
    expect(shippingCents("tracked", FREE)).toBe(0);
    expect(shippingCents("tracked", 999999)).toBe(0);
    // Automatic: picking the envelope on a big order no longer costs $1.50.
    expect(shippingCents("pwe", FREE)).toBe(0);
    expect(shippingCents("pwe", 999999)).toBe(0);
  });

  it("ships a free-shipping order tracked, and keeps the pick below the threshold", () => {
    expect(effectiveShippingMethod("pwe", FREE)).toBe("tracked");
    expect(effectiveShippingMethod("tracked", FREE)).toBe("tracked");
    expect(effectiveShippingMethod("pwe", FREE - 1)).toBe("pwe");
    expect(effectiveShippingMethod("tracked", FREE - 1)).toBe("tracked");
  });

  it("amountUntilFreeShipping counts down then floors at 0", () => {
    expect(amountUntilFreeShipping(0)).toBe(FREE);
    expect(amountUntilFreeShipping(6000)).toBe(1500);
    expect(amountUntilFreeShipping(FREE)).toBe(0);
    expect(amountUntilFreeShipping(999999)).toBe(0);
  });
});

describe("the browser's shipping numbers match the server's", () => {
  // The newest migration that defines the order function is what's deployed.
  const dir = "supabase/migrations";
  const file = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .find((name) => readFileSync(`${dir}/${name}`, "utf8").includes("function public.checkout_place_order_core("));
  const sql = file ? readFileSync(`${dir}/${file}`, "utf8") : "";
  const constant = (name: string) => Number(sql.match(new RegExp(`${name} constant integer := (\\d+);`))?.[1]);

  it("for both rates and the free shipping threshold", () => {
    expect(file).toBeTruthy();
    expect(constant("c_tracked_cents")).toBe(SHIPPING.trackedCents);
    expect(constant("c_pwe_cents")).toBe(SHIPPING.pweCents);
    expect(constant("c_free_shipping_threshold")).toBe(SHIPPING.freeShippingThresholdCents);
  });

  it("and the server makes a free-shipping order tracked", () => {
    expect(sql).toMatch(/if v_subtotal >= c_free_shipping_threshold then\s+(--[^\n]*\n\s*)?v_method := 'tracked';\s+v_shipping := 0;/);
    expect(sql).toContain("shipping_method = v_method,");
  });
});

describe("how shipping is shown", () => {
  it("says Free instead of $0.00", () => {
    expect(formatShipping(0)).toBe("Free");
    expect(formatShipping(550)).toBe("$5.50");
  });

  it("only for orders that ship: an in-person sale keeps the plain amount", () => {
    expect(orderShippingText({ shipping_method: "tracked", shipping_cents: 0 })).toBe("Free");
    expect(orderShippingText({ shipping_method: "pwe", shipping_cents: 150 })).toBe("$1.50");
    expect(orderShippingText({ shipping_method: null, shipping_cents: 0 })).toBe("$0.00");
  });

  it("drops .00 from whole-dollar amounts in copy", () => {
    expect(formatCentsShort(7500)).toBe("$75");
    expect(formatCentsShort(550)).toBe("$5.50");
  });
});

describe("previewOrderTotals clamps store credit like the RPC", () => {
  it("caps credit at balance and at total, never negative amount due", () => {
    const t = previewOrderTotals({
      subtotalCents: 1000,
      method: "pwe",
      storeCreditBalanceCents: 5000,
      storeCreditRequestedCents: 999999,
    });
    // total = 1000 + 150 pwe = 1150; credit capped at total
    expect(t.totalCents).toBe(1150);
    expect(t.storeCreditUsedCents).toBe(1150);
    expect(t.amountDueCents).toBe(0);
  });

  it("uses only what is requested when under balance and total", () => {
    const t = previewOrderTotals({
      subtotalCents: 10000,
      method: "tracked", // free at >= 7500
      storeCreditBalanceCents: 5000,
      storeCreditRequestedCents: 2000,
    });
    expect(t.shippingCents).toBe(0);
    expect(t.totalCents).toBe(10000);
    expect(t.storeCreditUsedCents).toBe(2000);
    expect(t.amountDueCents).toBe(8000);
  });

  it("gives free shipping on the cards' total, before store credit", () => {
    const t = previewOrderTotals({
      subtotalCents: 7500,
      method: "pwe",
      storeCreditBalanceCents: 7500,
      storeCreditRequestedCents: 7500,
    });
    expect(t.shippingCents).toBe(0);
    expect(t.totalCents).toBe(7500);
    expect(t.amountDueCents).toBe(0);
  });

  it("still charges shipping one cent under the threshold", () => {
    const t = previewOrderTotals({ subtotalCents: 7499, method: "tracked" });
    expect(t.shippingCents).toBe(550);
    expect(t.totalCents).toBe(8049);
  });
});

describe("formatCents", () => {
  it("formats USD", () => {
    expect(formatCents(1234)).toBe("$12.34");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(null)).toBe("$0.00");
  });
});

describe("guest cart line ops clamp to sellable (cart quantity limits)", () => {
  it("never adds more than sellable", () => {
    let lines: GuestCartLine[] = [];
    lines = addLine(lines, "a", 5, 3); // want 5, only 3 sellable
    expect(lines).toEqual([{ inventoryItemId: "a", quantity: 3 }]);
    lines = addLine(lines, "a", 5, 3); // still capped at 3
    expect(lines).toEqual([{ inventoryItemId: "a", quantity: 3 }]);
  });

  it("won't add when sellable is 0", () => {
    const lines = addLine([], "a", 1, 0);
    expect(lines).toEqual([]);
  });

  it("setLineQuantity clamps and removes at 0", () => {
    let lines: GuestCartLine[] = [{ inventoryItemId: "a", quantity: 2 }];
    lines = setLineQuantity(lines, "a", 10, 4); // clamp to 4
    expect(lines).toEqual([{ inventoryItemId: "a", quantity: 4 }]);
    lines = setLineQuantity(lines, "a", 0, 4); // remove
    expect(lines).toEqual([]);
  });

  it("removeLine drops the item", () => {
    const lines = removeLine([{ inventoryItemId: "a", quantity: 1 }], "a");
    expect(lines).toEqual([]);
  });
});

describe("planCartMerge (guest cart merge on sign-in)", () => {
  it("adds guest qty on top of server qty, clamped to sellable", () => {
    const plan = planCartMerge(
      [{ inventoryItemId: "a", quantity: 1 }],
      { a: 1 }, // already 1 on server
      { a: 5 }, // 5 sellable
    );
    expect(plan).toEqual([
      { inventoryItemId: "a", desiredQuantity: 2, clamped: false, dropped: false },
    ]);
  });

  it("clamps the merged quantity to current sellable stock", () => {
    const plan = planCartMerge(
      [{ inventoryItemId: "a", quantity: 3 }],
      { a: 2 }, // server 2 + guest 3 = 5 wanted
      { a: 4 }, // only 4 sellable
    );
    expect(plan[0]).toEqual({
      inventoryItemId: "a",
      desiredQuantity: 4,
      clamped: true,
      dropped: false,
    });
  });

  it("drops a line that is now fully reserved / out of stock", () => {
    const plan = planCartMerge(
      [{ inventoryItemId: "a", quantity: 2 }],
      {},
      { a: 0 }, // 0 sellable (e.g. fully reserved)
    );
    expect(plan[0]).toEqual({
      inventoryItemId: "a",
      desiredQuantity: 0,
      clamped: false,
      dropped: true,
    });
  });

  it("does not overwrite a server-only line", () => {
    const plan = planCartMerge([], { b: 2 }, { b: 5 });
    expect(plan).toEqual([
      { inventoryItemId: "b", desiredQuantity: 2, clamped: false, dropped: false },
    ]);
  });
});
