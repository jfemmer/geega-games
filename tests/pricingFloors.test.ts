import { describe, it, expect } from "vitest";
import { applyPriceFloor } from "../src/admin/utils/pricing";
import type { InventoryPriceFloor } from "../src/admin/types";

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
