import { describe, it, expect } from "vitest";
import {
  SHIPPING,
  shippingCents,
  previewOrderTotals,
  amountUntilFreeShipping,
  formatCents,
} from "../src/store/lib/money";
import {
  addLine,
  setLineQuantity,
  removeLine,
  planCartMerge,
  type GuestCartLine,
} from "../src/store/lib/guestCart";

describe("shipping math mirrors checkout_create_order", () => {
  it("charges tracked shipping below the free threshold", () => {
    expect(shippingCents("tracked", 100)).toBe(SHIPPING.trackedCents);
    expect(shippingCents("tracked", SHIPPING.freeTrackedThresholdCents - 1)).toBe(
      SHIPPING.trackedCents,
    );
  });

  it("is free for tracked at/above the threshold", () => {
    expect(shippingCents("tracked", SHIPPING.freeTrackedThresholdCents)).toBe(0);
    expect(shippingCents("tracked", 999999)).toBe(0);
  });

  it("always charges the flat PWE rate", () => {
    expect(shippingCents("pwe", 100)).toBe(SHIPPING.pweCents);
    expect(shippingCents("pwe", 999999)).toBe(SHIPPING.pweCents);
  });

  it("amountUntilFreeShipping counts down then floors at 0", () => {
    expect(amountUntilFreeShipping(0)).toBe(SHIPPING.freeTrackedThresholdCents);
    expect(amountUntilFreeShipping(SHIPPING.freeTrackedThresholdCents)).toBe(0);
    expect(amountUntilFreeShipping(999999)).toBe(0);
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
      method: "tracked", // free at >= 8500
      storeCreditBalanceCents: 5000,
      storeCreditRequestedCents: 2000,
    });
    expect(t.shippingCents).toBe(0);
    expect(t.totalCents).toBe(10000);
    expect(t.storeCreditUsedCents).toBe(2000);
    expect(t.amountDueCents).toBe(8000);
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
