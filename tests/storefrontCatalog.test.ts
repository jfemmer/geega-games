import { describe, expect, it } from "vitest";
import { mapInventoryPublicRow, type Card } from "../src/cards";
import type { Database } from "../src/types/database";

type Row = Database["public"]["Views"]["inventory_public"]["Row"];

// The storefront reads the canonical inventory_public view. These tests lock in
// the safe transform: dollars from cents, legacy `foil` derived from the exact
// finish, and null-tolerance for legacy rows. Archived rows never reach this
// function because the view filters status='active' server-side.

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    scryfall_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    oracle_id: null,
    set_code: "MH2",
    collector_number: "138",
    language: "en",
    card_name: "Ragavan, Nimble Pilferer",
    set_name: "Modern Horizons 2",
    rarity: "mythic",
    type_line: "Legendary Creature — Monkey Pirate",
    colors: null,
    creature_types: null,
    image_url: "https://cards.scryfall.io/normal/x.jpg",
    condition: "NM",
    finish: "nonfoil",
    foil: false,
    variant_type: "",
    quantity: 4,
    price_cents: 6500,
    scryfall_price_cents: 7000,
    ...overrides,
  };
}

describe("mapInventoryPublicRow", () => {
  it("converts cents to dollars and copies core fields", () => {
    const c: Card = mapInventoryPublicRow(row());
    expect(c.name).toBe("Ragavan, Nimble Pilferer");
    expect(c.set).toBe("MH2");
    expect(c.setName).toBe("Modern Horizons 2");
    expect(c.price_usd).toBe(65);
    expect(c.quantity).toBe(4);
    expect(c.scryfallId).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  });

  it("derives the legacy foil boolean from any non-nonfoil finish", () => {
    expect(mapInventoryPublicRow(row({ finish: "nonfoil" })).foil).toBe(false);
    expect(mapInventoryPublicRow(row({ finish: "foil" })).foil).toBe(true);
    expect(mapInventoryPublicRow(row({ finish: "etched" })).foil).toBe(true);
    expect(mapInventoryPublicRow(row({ finish: "galaxy" })).foil).toBe(true);
    // …but the exact finish is still preserved for richer UI.
    expect(mapInventoryPublicRow(row({ finish: "etched" })).finish).toBe(
      "etched",
    );
  });

  it("treats a null price as unpriced (0), not a crash", () => {
    const c = mapInventoryPublicRow(row({ price_cents: null }));
    expect(c.price_usd).toBe(0);
  });

  it("tolerates legacy null set_name / type / rarity / scryfall_id", () => {
    const c = mapInventoryPublicRow(
      row({
        set_name: null,
        type_line: null,
        rarity: null,
        scryfall_id: null,
      }),
    );
    expect(c.setName).toBeNull();
    expect(c.type).toBeNull();
    expect(c.rarity).toBeNull();
    expect(c.scryfallId).toBeNull();
  });
});