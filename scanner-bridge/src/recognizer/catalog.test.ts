import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entriesFromRow, entryKey, fetchCatalog, type CatalogRow } from "./catalog.js";

function row(overrides: Partial<CatalogRow>): CatalogRow {
  return {
    scryfall_id: "11111111-1111-4111-8111-111111111111",
    card_name: "Lightning Bolt",
    set_code: "m10",
    collector_number: "146",
    lang: "en",
    layout: "normal",
    finishes: ["nonfoil", "foil"],
    bulk_updated_at: "2026-09-16T03:22:29.000Z",
    image_uris: { normal: "https://cards.scryfall.io/normal/front/1/1/x.jpg?1" },
    card_faces: null,
    games: ["paper", "mtgo"],
    illustration_id: "ill-1",
    oversized: false,
    ...overrides,
  };
}

describe("entriesFromRow", () => {
  it("makes one entry for a normal paper card, set code upper-cased", () => {
    expect(entriesFromRow(row({}))).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        face: 0,
        name: "Lightning Bolt",
        set: "M10",
        cn: "146",
        lang: "en",
        ill: "ill-1",
        img: "https://cards.scryfall.io/normal/front/1/1/x.jpg?1",
        finishes: ["nonfoil", "foil"],
        layout: "normal",
      },
    ]);
  });

  it("makes one entry per face for a double-faced card", () => {
    const entries = entriesFromRow(
      row({
        layout: "transform",
        image_uris: null,
        illustration_id: null,
        card_faces: [
          { illustration_id: "front-ill", image_uris: { normal: "https://img/front.jpg" } },
          { illustration_id: "back-ill", image_uris: { normal: "https://img/back.jpg" } },
        ],
      }),
    );
    expect(entries.map((e) => [e.face, e.ill, e.img])).toEqual([
      [0, "front-ill", "https://img/front.jpg"],
      [1, "back-ill", "https://img/back.jpg"],
    ]);
  });

  it("uses the single image of a split/adventure card, with the first face's art id", () => {
    const entries = entriesFromRow(row({ layout: "adventure", illustration_id: null, card_faces: [{ illustration_id: "a" }, { illustration_id: "a" }] }));
    expect(entries).toHaveLength(1);
    expect(entries[0].ill).toBe("a");
  });

  it("skips what can't be scanned: digital-only, oversized, no image", () => {
    expect(entriesFromRow(row({ games: ["arena"] }))).toEqual([]);
    expect(entriesFromRow(row({ oversized: true }))).toEqual([]);
    expect(entriesFromRow(row({ image_uris: null, card_faces: null }))).toEqual([]);
  });
});

describe("entryKey", () => {
  it("changes when Scryfall replaces the image", () => {
    const e = entriesFromRow(row({}))[0];
    expect(entryKey(e)).not.toBe(entryKey({ ...e, img: e.img.replace("?1", "?2") }));
  });
});

describe("fetchCatalog", () => {
  it("pages through the card list in id order and reports the newest refresh", async () => {
    const all = Array.from({ length: 2500 }, (_, i) =>
      row({
        scryfall_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        bulk_updated_at: i === 1700 ? "2026-10-01T00:00:00.000Z" : "2026-09-16T03:22:29.000Z",
        games: i % 10 === 0 ? ["arena"] : ["paper"],
      }),
    );
    const calls: { gt: string | null }[] = [];
    const supabase = {
      from(table: string) {
        expect(table).toBe("scryfall_bulk_cards");
        let gt: string | null = null;
        let limit = 1000;
        const q = {
          select: () => q,
          order: () => q,
          limit: (n: number) => {
            limit = n;
            return q;
          },
          gt: (_col: string, v: string) => {
            gt = v;
            return q;
          },
          then(resolve: (v: unknown) => void) {
            calls.push({ gt });
            const start = gt ? all.findIndex((r) => r.scryfall_id === gt) + 1 : 0;
            resolve({ data: all.slice(start, start + limit), error: null });
          },
        };
        return q;
      },
    } as unknown as SupabaseClient;
    const progress: number[] = [];
    const snapshot = await fetchCatalog(supabase, (n) => progress.push(n));
    expect(snapshot.printings).toBe(2500);
    expect(snapshot.entries).toHaveLength(2250);
    expect(snapshot.refreshedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(calls.map((c) => c.gt)).toEqual([null, all[999].scryfall_id, all[1999].scryfall_id]);
    expect(progress).toEqual([1000, 2000, 2500]);
  });
});
