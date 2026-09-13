import { describe, expect, it } from "vitest";
import {
  mapInventoryRow,
  mapMovementRow,
  normalizeRarity,
  type InventoryRowLike,
  type MovementRowLike,
} from "../src/admin/repositories/inventory.mapper";

// These tests cover the PURE mapping logic that turns live Supabase rows into
// the domain shapes the admin UI + storefront consume. They need no database.

function baseRow(overrides: Partial<InventoryRowLike> = {}): InventoryRowLike {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    scryfall_id: "22222222-2222-2222-2222-222222222222",
    oracle_id: null,
    card_name: "Ragavan, Nimble Pilferer",
    set_code: "MH2",
    set_name: "Modern Horizons 2",
    collector_number: "138",
    rarity: "mythic",
    type_line: "Legendary Creature — Monkey Pirate",
    image_url: "https://cards.scryfall.io/normal/x.jpg",
    condition: "NM",
    finish: "nonfoil",
    quantity: 4,
    price_cents: 6500,
    cost_cents: 4000,
    scryfall_price_cents: 7000,
    storage_location: "Bin A1",
    sku: "MH2-138-NM-NF",
    notes: "clean",
    status: "active",
    variant_type: "",
    language: "en",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("normalizeRarity", () => {
  it("passes through known rarities", () => {
    expect(normalizeRarity("mythic")).toBe("mythic");
    expect(normalizeRarity("Rare")).toBe("rare");
  });
  it("returns null for unknown/empty rarity (legacy rows)", () => {
    expect(normalizeRarity(null)).toBeNull();
    expect(normalizeRarity("")).toBeNull();
    expect(normalizeRarity("bulk")).toBeNull();
  });
});

describe("mapInventoryRow", () => {
  it("maps a fully-populated row to the domain shape", () => {
    const item = mapInventoryRow(baseRow());
    expect(item.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(item.scryfallId).toBe("22222222-2222-2222-2222-222222222222");
    expect(item.cardName).toBe("Ragavan, Nimble Pilferer");
    expect(item.setName).toBe("Modern Horizons 2");
    expect(item.cardType).toBe("Legendary Creature — Monkey Pirate");
    expect(item.rarity).toBe("mythic");
    expect(item.priceCents).toBe(6500);
    expect(item.status).toBe("active");
    expect(item.finish).toBe("nonfoil");
  });

  it("tolerates null legacy fields (no scryfall_id / rarity / set_name)", () => {
    const item = mapInventoryRow(
      baseRow({
        scryfall_id: null,
        rarity: null,
        set_name: null,
        type_line: null,
        price_cents: null,
        cost_cents: null,
      }),
    );
    expect(item.scryfallId).toBeNull();
    expect(item.rarity).toBeNull();
    expect(item.setName).toBeNull();
    expect(item.cardType).toBeNull();
    // Null price coerces to 0 cents for safe display/formatting.
    expect(item.priceCents).toBe(0);
    expect(item.costCents).toBeNull();
  });

  it("preserves the exact finish (not just a foil boolean)", () => {
    expect(mapInventoryRow(baseRow({ finish: "etched" })).finish).toBe("etched");
    expect(mapInventoryRow(baseRow({ finish: "galaxy" })).finish).toBe("galaxy");
  });
});

describe("mapMovementRow", () => {
  it("maps a ledger row including actor + note", () => {
    const row: MovementRowLike = {
      id: "m1",
      inventory_item_id: "inv1",
      card_name: "Lightning Bolt",
      delta: 3,
      previous_quantity: 1,
      resulting_quantity: 4,
      reason: "manual_add",
      related_order_number: null,
      actor: "Jordan Vega",
      note: "restock",
      created_at: "2026-01-03T00:00:00Z",
    };
    const mv = mapMovementRow(row);
    expect(mv.delta).toBe(3);
    expect(mv.resultingQuantity).toBe(4);
    expect(mv.actor).toBe("Jordan Vega");
    expect(mv.note).toBe("restock");
    expect(mv.reason).toBe("manual_add");
  });
});