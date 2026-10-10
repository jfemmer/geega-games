import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  MEMBER_DISCOUNT_PERCENT,
  SHIPPING,
  memberDiscountCents,
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

  it("and the member discount: the same percentage, the same rounding, for signed-in orders only", () => {
    expect(constant("c_member_discount_percent")).toBe(MEMBER_DISCOUNT_PERCENT);
    // Half up, in whole cents: memberDiscountCents uses the same arithmetic.
    expect(sql).toContain("((v_subtotal::bigint * c_member_discount_percent + 50) / 100)::integer");
    // Only for a signed-in customer (guest checkout passes no user).
    expect(sql).toMatch(/if p_uid is not null\s+and not exists \(select 1 from auth\.users u where u\.id = p_uid and u\.is_anonymous\) then\s+v_discount :=/);
    // Free shipping is decided before the discount, on the cards' full price,
    // and the total takes the discount off the cards only.
    expect(sql.indexOf("if v_subtotal >= c_free_shipping_threshold then")).toBeLessThan(sql.indexOf("v_discount := (("));
    expect(sql).toContain("v_total := v_subtotal - v_discount + v_shipping;");
    expect(sql).toContain("discount_cents = v_discount,");
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

describe("the member discount", () => {
  it("is 5% of the cards, to the nearest cent, halves to the customer", () => {
    expect(MEMBER_DISCOUNT_PERCENT).toBe(5);
    expect(memberDiscountCents(1059)).toBe(53); // 52.95 cents
    expect(memberDiscountCents(1010)).toBe(51); // 50.5 cents
    expect(memberDiscountCents(1999)).toBe(100); // 99.95 cents
    expect(memberDiscountCents(7600)).toBe(380);
    expect(memberDiscountCents(10)).toBe(1); // 0.5 cents
    expect(memberDiscountCents(9)).toBe(0); // 0.45 cents
  });

  it("is nothing on an empty or nonsensical subtotal", () => {
    expect(memberDiscountCents(0)).toBe(0);
    expect(memberDiscountCents(-500)).toBe(0);
    expect(memberDiscountCents(Number.NaN)).toBe(0);
  });

  it("comes off a signed-in customer's cards, not their shipping", () => {
    const t = previewOrderTotals({ subtotalCents: 1059, method: "tracked", member: true });
    expect(t).toEqual({
      subtotalCents: 1059,
      discountCents: 53,
      shippingCents: SHIPPING.trackedCents,
      totalCents: 1059 - 53 + SHIPPING.trackedCents,
      storeCreditUsedCents: 0,
      amountDueCents: 1059 - 53 + SHIPPING.trackedCents,
    });
  });

  it("isn't given to a guest", () => {
    const t = previewOrderTotals({ subtotalCents: 1059, method: "tracked" });
    expect(t.discountCents).toBe(0);
    expect(t.totalCents).toBe(1059 + SHIPPING.trackedCents);
  });

  it("never costs an order its free shipping: that's judged on the cards' full price", () => {
    // $76 of cards: $72.20 after the discount, and still free shipping.
    const t = previewOrderTotals({ subtotalCents: 7600, method: "pwe", member: true });
    expect(t).toMatchObject({ discountCents: 380, shippingCents: 0, totalCents: 7220, amountDueCents: 7220 });
    // A guest with the same cart pays more.
    expect(previewOrderTotals({ subtotalCents: 7600, method: "pwe" }).totalCents).toBeGreaterThan(t.totalCents);
  });

  it("lets store credit pay toward the discounted total, never beyond it", () => {
    const t = previewOrderTotals({
      subtotalCents: 2000,
      method: "pwe",
      member: true,
      storeCreditBalanceCents: 5000,
      storeCreditRequestedCents: 5000,
    });
    expect(t).toMatchObject({ discountCents: 100, totalCents: 2050, storeCreditUsedCents: 2050, amountDueCents: 0 });
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
