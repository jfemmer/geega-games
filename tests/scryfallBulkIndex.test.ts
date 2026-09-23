import { describe, expect, it, vi } from "vitest";
import { candidatesByName } from "../api/_lib/scryfallBulkIndex";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import type { ScryfallCard } from "../src/admin/services/scryfall.types";

// candidatesByName is the OCR-noise-exposed fallback path (Part 7): it must
// call the real trigram-similarity RPC (search_scryfall_bulk_by_name_trgm),
// never a plain substring match that a single misread character (Tesseract's
// classic 0/O, B/8 confusions) would silently defeat. These tests exercise
// the call contract against a fake admin client — never a real database.

type BulkRow = Database["public"]["Tables"]["scryfall_bulk_cards"]["Row"];

function rawCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    object: "card",
    id: "11111111-1111-1111-1111-111111111111",
    oracle_id: "22222222-2222-2222-2222-222222222222",
    name: "Lightning Bolt",
    lang: "en",
    released_at: "2021-06-18",
    layout: "normal",
    set: "mh2",
    set_name: "Modern Horizons 2",
    collector_number: "138",
    rarity: "uncommon",
    type_line: "Instant",
    artist: "Christopher Rush",
    frame: "2015",
    border_color: "black",
    finishes: ["nonfoil"],
    image_uris: { normal: "https://img/n.jpg" },
    ...overrides,
  } as ScryfallCard;
}

function bulkRow(overrides: Partial<BulkRow> = {}): BulkRow {
  const raw = rawCard();
  return {
    scryfall_id: raw.id,
    oracle_id: raw.oracle_id ?? null,
    card_name: raw.name,
    printed_name: null,
    set_code: raw.set.toUpperCase(),
    set_name: raw.set_name,
    collector_number: raw.collector_number,
    lang: raw.lang,
    layout: raw.layout,
    rarity: raw.rarity,
    released_at: raw.released_at ?? null,
    frame: raw.frame ?? null,
    frame_effects: [],
    border_color: raw.border_color ?? null,
    full_art: false,
    textless: false,
    promo: false,
    promo_types: [],
    variation: false,
    finishes: raw.finishes,
    raw: raw as unknown as BulkRow["raw"],
    bulk_updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function fakeAdmin(rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

describe("candidatesByName", () => {
  it("calls the trgm RPC (never a substring match) and maps rows to CardPrinting", async () => {
    const calls: { fn: string; args: unknown }[] = [];
    const admin = fakeAdmin(async (fn, args) => {
      calls.push({ fn, args });
      return { data: [bulkRow()], error: null };
    });

    const result = await candidatesByName(admin, "Lightning 8olt");

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("search_scryfall_bulk_by_name_trgm");
    expect(calls[0].args).toEqual({ p_name: "Lightning 8olt", p_limit: 30 });
    expect(result).toHaveLength(1);
    expect(result[0].cardName).toBe("Lightning Bolt");
    expect(result[0].setCode).toBe("MH2");
  });

  it("passes a custom limit through as p_limit", async () => {
    let capturedArgs: unknown;
    const admin = fakeAdmin(async (_fn, args) => {
      capturedArgs = args;
      return { data: [], error: null };
    });

    await candidatesByName(admin, "Sol Ring", 5);
    expect(capturedArgs).toEqual({ p_name: "Sol Ring", p_limit: 5 });
  });

  it("trims the search text before sending it", async () => {
    let capturedArgs: unknown;
    const admin = fakeAdmin(async (_fn, args) => {
      capturedArgs = args;
      return { data: [], error: null };
    });

    await candidatesByName(admin, "  Sol Ring  ");
    expect(capturedArgs).toEqual({ p_name: "Sol Ring", p_limit: 30 });
  });

  it("returns [] without calling the RPC for an empty/whitespace name", async () => {
    const rpc = vi.fn();
    const admin = { rpc } as unknown as SupabaseClient<Database>;

    expect(await candidatesByName(admin, "   ")).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns [] (never throws) when the RPC errors", async () => {
    const admin = fakeAdmin(async () => ({ data: null, error: { message: "boom" } }));
    expect(await candidatesByName(admin, "Lightning Bolt")).toEqual([]);
  });

  it("passes setCode through as p_set_code when given (set-first narrowing)", async () => {
    let capturedArgs: unknown;
    const admin = fakeAdmin(async (_fn, args) => {
      capturedArgs = args;
      return { data: [], error: null };
    });

    await candidatesByName(admin, "Lightning Bolt", 5, "mh2");
    expect(capturedArgs).toEqual({ p_name: "Lightning Bolt", p_limit: 5, p_set_code: "mh2" });
  });

  it("omits p_set_code entirely (not even null) when no set is known yet", async () => {
    let capturedArgs: unknown;
    const admin = fakeAdmin(async (_fn, args) => {
      capturedArgs = args;
      return { data: [], error: null };
    });

    await candidatesByName(admin, "Lightning Bolt");
    expect(capturedArgs).toEqual({ p_name: "Lightning Bolt", p_limit: 30 });
    expect(capturedArgs).not.toHaveProperty("p_set_code");
  });
});
