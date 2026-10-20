import { beforeEach, describe, expect, it, vi } from "vitest";

// The hand of cards on the printed yard sale sign
// (yardSaleRepository.showcase): the most valuable newer cards (printings
// released in the last two years) that the yard sale page shows. Newer
// printings come from card_printings, the cards from the yard sale page's
// own search narrowed to their sets.

type Result = { data: unknown; error: unknown };

const db = vi.hoisted(() => ({
  printings: { data: [], error: null } as Result,
  search: { data: [], error: null } as Result,
  queries: [] as Array<{ table: string; select?: string; gte?: unknown[]; order?: unknown[]; limit?: number }>,
  rpcs: [] as Array<[string, Record<string, unknown>]>,
}));

vi.mock("../src/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from(table: string) {
      const query: (typeof db.queries)[number] = { table };
      db.queries.push(query);
      const chain = {
        select(columns: string) {
          query.select = columns;
          return chain;
        },
        gte(column: string, value: string) {
          query.gte = [column, value];
          return chain;
        },
        order(column: string, options: unknown) {
          query.order = [column, options];
          return chain;
        },
        limit(n: number) {
          query.limit = n;
          return Promise.resolve(db.printings);
        },
      };
      return chain;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      db.rpcs.push([fn, args]);
      return Promise.resolve(db.search);
    },
  },
}));

const { yardSaleRepository } = await import("../src/admin/repositories/yardSale.supabase");

function card(id: string, name: string, priceCents: number, setCode: string) {
  return {
    id,
    scryfall_id: `sf-${id}`,
    card_name: name,
    set_code: setCode,
    set_name: setCode,
    collector_number: "1",
    rarity: "mythic",
    type_line: "Artifact",
    finish: "nonfoil",
    condition: "NM",
    quantity: 1,
    price_cents: priceCents,
    total_count: 3,
    image_url: `https://cards.scryfall.io/large/front/a/b/${id}.jpg`,
  };
}

const NOW = new Date(2026, 9, 20, 13, 0);

beforeEach(() => {
  db.queries.length = 0;
  db.rpcs.length = 0;
  db.printings = {
    data: [
      { scryfall_id: "sf-ring", set_code: "HOC" },
      { scryfall_id: "sf-ugin", set_code: "TDM" },
      { scryfall_id: "sf-new-list", set_code: "PLST" },
    ],
    error: null,
  };
  db.search = {
    data: [
      card("ring", "The One Ring", 12000, "HOC"),
      // An older printing on The List, which also has a newer one.
      card("old-list", "Sol Ring", 8000, "PLST"),
      card("ugin", "Ugin, Eye of the Storms", 3900, "TDM"),
      card("new-list", "Arcane Signet", 600, "PLST"),
    ],
    error: null,
  };
});

describe("the sign's hand of cards", () => {
  it("looks up the printings released in the last two years", async () => {
    await yardSaleRepository.showcase(300, NOW);
    expect(db.queries).toEqual([
      {
        table: "card_printings",
        select: "scryfall_id, set_code",
        gte: ["released_at", "2024-10-20"],
        order: ["released_at", { ascending: false }],
        limit: 1000,
      },
    ]);
  });

  it("searches the yard sale page's cards in those sets, most valuable first", async () => {
    await yardSaleRepository.showcase(300, NOW);
    expect(db.rpcs).toEqual([
      [
        "search_inventory",
        {
          p_sets: ["HOC", "TDM", "PLST"],
          p_sort: "price_desc",
          p_limit: 100,
          p_offset: 0,
          p_min_price_cents: 300,
          p_in_stock_only: true,
        },
      ],
    ]);
  });

  it("keeps only the newer printings themselves", async () => {
    expect(await yardSaleRepository.showcase(300, NOW)).toEqual([
      { id: "ring", name: "The One Ring", imageUrl: "https://cards.scryfall.io/large/front/a/b/ring.jpg" },
      { id: "ugin", name: "Ugin, Eye of the Storms", imageUrl: "https://cards.scryfall.io/large/front/a/b/ugin.jpg" },
      { id: "new-list", name: "Arcane Signet", imageUrl: "https://cards.scryfall.io/large/front/a/b/new-list.jpg" },
    ]);
  });

  it("asks for priced cards when the sale shows all of them", async () => {
    await yardSaleRepository.showcase(0, NOW);
    expect(db.rpcs[0][1].p_min_price_cents).toBe(1);
  });

  it("doesn't search when nothing newer has been stocked", async () => {
    db.printings = { data: [], error: null };
    expect(await yardSaleRepository.showcase(300, NOW)).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });

  it("fails plainly when either lookup fails", async () => {
    db.printings = { data: null, error: { message: "boom" } };
    await expect(yardSaleRepository.showcase(300, NOW)).rejects.toThrow("Could not load the cards to feature.");
    db.printings = { data: [{ scryfall_id: "sf-ring", set_code: "HOC" }], error: null };
    db.search = { data: null, error: { message: "boom" } };
    await expect(yardSaleRepository.showcase(300, NOW)).rejects.toThrow("Could not load the cards to feature.");
  });
});
