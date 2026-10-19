import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCard } from "../src/store/lib/useCatalog";

// "Shop your deck" on the yard sale page: what a pasted decklist asks for,
// how each card is filled from the copies we have (cheapest first), and the
// database function that finds them.

const rpc = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../src/supabase", () => ({ supabase: { rpc: rpc.fn }, isSupabaseConfigured: true }));

const { allocateDeckCards, deckWants, findYardSaleDeckCards } = await import("../src/store/lib/yardSaleDeck");

function card(id: string, name: string, priceCents: number, quantity: number): CatalogCard {
  return {
    id, oracleId: null, name, set: "set", setName: "Some Set", collectorNumber: "1", type: null, rarity: null, quantity,
    imageUrl: null, priceCents, condition: "NM", finish: "nonfoil", foil: false, scryfallId: null, isDeal: false,
    originalPriceCents: null, dealDiscountPercent: null, dealSource: null, dealNote: null, variantType: null,
  };
}

beforeEach(() => rpc.fn.mockReset());

describe("what a deck asks for", () => {
  it("adds up the commander, main deck and sideboard, and leaves out the maybeboard", () => {
    const wants = deckWants(
      [
        "1x Atraxa, Praetors' Voice (2x2) 190 [Commander{top}]",
        "3 Lightning Bolt (2XM) 141",
        "1x Rhystic Study (pcy) 45 [Maybeboard{noDeck}{noPrice}]",
        "",
        "SIDEBOARD:",
        "1 Lightning Bolt (M10) 146",
      ].join("\n"),
    );
    expect(wants).toEqual([
      { name: "Atraxa, Praetors' Voice", quantity: 1 },
      { name: "Lightning Bolt", quantity: 4 },
    ]);
  });

  it("caps a card at the 20 copies a list can hold", () => {
    expect(deckWants("36 Island")).toEqual([{ name: "Island", quantity: 20 }]);
  });

  it("finds nothing in text that isn't a list", () => {
    expect(deckWants("   \n\n// just a comment")).toEqual([]);
  });
});

describe("filling a deck from the copies we have", () => {
  it("takes the cheapest copies first, across printings", () => {
    const result = allocateDeckCards(
      [{ name: "Lightning Bolt", quantity: 4 }],
      [
        { inputName: "Lightning Bolt", card: card("a", "Lightning Bolt", 300, 1) },
        { inputName: "Lightning Bolt", card: card("b", "Lightning Bolt", 450, 5) },
      ],
    );
    expect(result.found).toEqual([
      expect.objectContaining({ name: "Lightning Bolt", wanted: 4, found: 4 }),
    ]);
    expect(result.found[0].lines.map((l) => [l.card.id, l.quantity])).toEqual([
      ["a", 1],
      ["b", 3],
    ]);
    expect(result).toMatchObject({ wantedCopies: 4, foundCopies: 4, missing: [] });
  });

  it("says when only some copies are here, and which cards aren't", () => {
    const result = allocateDeckCards(
      [
        { name: "Sol Ring", quantity: 1 },
        { name: "Ragavan, Nimble Pilferer", quantity: 4 },
        { name: "Mox Diamond", quantity: 1 },
      ],
      [
        // The name as the database echoes it back (any case).
        { inputName: "ragavan, nimble pilferer", card: card("r", "Ragavan, Nimble Pilferer", 4250, 2) },
        { inputName: "Sol Ring", card: card("s", "Sol Ring", 300, 3) },
      ],
    );
    expect(result.found.map((c) => [c.name, c.found, c.wanted])).toEqual([
      ["Sol Ring", 1, 1],
      ["Ragavan, Nimble Pilferer", 2, 4],
    ]);
    expect(result.missing).toEqual([{ name: "Mox Diamond", quantity: 1 }]);
    expect(result).toMatchObject({ wantedCopies: 6, foundCopies: 3 });
  });

  it("looks the names up with yard_sale_deck_matches and maps its rows like the catalog's", async () => {
    rpc.fn.mockResolvedValue({
      data: [
        {
          input_name: "Sol Ring", id: "s", oracle_id: null, scryfall_id: null, set_code: "c21", set_name: "Commander 2021",
          collector_number: "263", card_name: "Sol Ring", rarity: "uncommon", type_line: "Artifact", image_url: null,
          condition: "LP", finish: "foil", variant_type: null, quantity: 2, price_cents: 350, original_price_cents: null,
          deal_discount_percent: null, deal_source: null, deal_note: null,
        },
      ],
      error: null,
    });
    const result = await findYardSaleDeckCards([{ name: "Sol Ring", quantity: 1 }]);
    expect(rpc.fn).toHaveBeenCalledWith("yard_sale_deck_matches", { p_names: ["Sol Ring"] });
    expect(result.found[0].lines[0].card).toMatchObject({ id: "s", name: "Sol Ring", setName: "Commander 2021", condition: "LP", foil: true, priceCents: 350, quantity: 2 });
  });

  it("says so when the lookup fails", async () => {
    rpc.fn.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(findYardSaleDeckCards([{ name: "Sol Ring", quantity: 1 }])).rejects.toThrow("We couldn't check your deck");
  });
});

describe("the database function", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261019190000_yard_sale_whole_dollars_deck_search.sql", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const body = sql.slice(sql.indexOf("create or replace function public.yard_sale_deck_matches"));

  it("only offers the yard sale page's own cards, while a sale is on", () => {
    expect(body).toContain("where ys.ended_at is null and now() < ys.ends_at");
    expect(body).toContain("and s.live_price >= sale.min_price_cents");
    expect(body).toContain("where s.sellable > 0");
    expect(body).toContain("where i.status = 'active' and i.quantity > 0");
    expect(body).toContain("public.storefront_effective_price(i.price_cents, i.original_price_cents, i.is_deal) as live_price");
  });

  it("matches whole names and the front of double-faced cards, up to five printings, for anyone", () => {
    expect(body).toContain("w.name_key in (lower(s.card_name), lower(split_part(s.card_name, ' // ', 1)))");
    expect(body).toContain("where m.pick <= 5");
    expect(body).toContain("unnest(p_names[1:250])");
    expect(body).toContain("grant execute on function public.yard_sale_deck_matches(text[]) to anon, authenticated, service_role;");
  });
});
