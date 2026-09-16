import { describe, it, expect } from "vitest";
import { applyPriceFloor, countRepriceable, isRepriceable } from "../src/admin/utils/pricing";
import type { FloorableRarity, InventoryPriceFloor } from "../src/admin/types";

function floors(overrides: Partial<Record<InventoryPriceFloor["rarity"], number>>): InventoryPriceFloor[] {
  const base: Record<InventoryPriceFloor["rarity"], number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    mythic: 0,
  };
  return (Object.keys(base) as InventoryPriceFloor["rarity"][]).map((rarity) => ({
    rarity,
    minPriceCents: overrides[rarity] ?? base[rarity],
    updatedAt: "2026-01-01T00:00:00Z",
    updatedBy: null,
  }));
}

describe("applyPriceFloor", () => {
  it("raises a below-floor price up to the rarity's minimum", () => {
    expect(applyPriceFloor(50, "mythic", floors({ mythic: 200 }))).toBe(200);
  });

  it("never lowers a price already at or above the floor", () => {
    expect(applyPriceFloor(500, "rare", floors({ rare: 200 }))).toBe(500);
    expect(applyPriceFloor(200, "rare", floors({ rare: 200 }))).toBe(200);
  });

  it("leaves the price unchanged when the floor for that rarity is 0 (unset)", () => {
    expect(applyPriceFloor(50, "common", floors({}))).toBe(50);
  });

  it("leaves the price unchanged for rarities with no floor row (e.g. special)", () => {
    expect(applyPriceFloor(50, "special", floors({ common: 999 }))).toBe(50);
  });

  it("leaves the price unchanged when rarity is null/undefined", () => {
    expect(applyPriceFloor(50, null, floors({ common: 999 }))).toBe(50);
    expect(applyPriceFloor(50, undefined, floors({ common: 999 }))).toBe(50);
  });

  it("passes through a null price untouched", () => {
    expect(applyPriceFloor(null, "mythic", floors({ mythic: 999 }))).toBeNull();
  });

  it("applies each rarity's own independent floor", () => {
    const f = floors({ common: 25, uncommon: 50, rare: 100, mythic: 300 });
    expect(applyPriceFloor(10, "common", f)).toBe(25);
    expect(applyPriceFloor(10, "uncommon", f)).toBe(50);
    expect(applyPriceFloor(10, "rare", f)).toBe(100);
    expect(applyPriceFloor(10, "mythic", f)).toBe(300);
  });
});

type Item = { rarity: string | null; status: string; priceCents: number };

describe("isRepriceable", () => {
  it("is true for a matching, non-archived, below-floor item", () => {
    const item: Item = { rarity: "rare", status: "active", priceCents: 50 };
    expect(isRepriceable(item, "rare", 200)).toBe(true);
  });

  it("is false when the item is already at or above the floor", () => {
    expect(isRepriceable({ rarity: "rare", status: "active", priceCents: 200 }, "rare", 200)).toBe(false);
    expect(isRepriceable({ rarity: "rare", status: "active", priceCents: 500 }, "rare", 200)).toBe(false);
  });

  it("is false for a different rarity", () => {
    expect(isRepriceable({ rarity: "common", status: "active", priceCents: 10 }, "rare", 200)).toBe(false);
  });

  it("is false for an archived item, even if reserved stays eligible", () => {
    expect(isRepriceable({ rarity: "rare", status: "archived", priceCents: 10 }, "rare", 200)).toBe(false);
    expect(isRepriceable({ rarity: "rare", status: "reserved", priceCents: 10 }, "rare", 200)).toBe(true);
  });

  it("is false when the floor is 0 (unset), regardless of price", () => {
    expect(isRepriceable({ rarity: "rare", status: "active", priceCents: 10 }, "rare", 0)).toBe(false);
  });
});

describe("countRepriceable", () => {
  const items: Item[] = [
    { rarity: "common", status: "active", priceCents: 10 },
    { rarity: "common", status: "active", priceCents: 100 },
    { rarity: "common", status: "archived", priceCents: 10 },
    { rarity: "rare", status: "active", priceCents: 50 },
    { rarity: "rare", status: "reserved", priceCents: 50 },
    { rarity: "mythic", status: "active", priceCents: 1000 },
  ];
  const floorsByRarity: Record<FloorableRarity, number> = {
    common: 25,
    uncommon: 0,
    rare: 200,
    mythic: 0,
  };

  it("counts affected items per rarity and in total", () => {
    const counts = countRepriceable(items, floorsByRarity);
    expect(counts.common).toBe(1); // the $0.10 active one; archived and the $1.00 one are excluded
    expect(counts.uncommon).toBe(0); // no floor set
    expect(counts.rare).toBe(2); // both the active and reserved lines
    expect(counts.mythic).toBe(0); // no floor set, even though $10.00 is a real card
    expect(counts.total).toBe(3);
  });

  it("returns all zeros when no floors are set", () => {
    const counts = countRepriceable(items, { common: 0, uncommon: 0, rare: 0, mythic: 0 });
    expect(counts.total).toBe(0);
  });
});
