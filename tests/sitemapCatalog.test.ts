import { describe, expect, it } from "vitest";
import { catalogEntries, type SitemapInventoryRow } from "../api/_lib/sitemapCatalog";
import { MIN_INDEXABLE_SET_LISTINGS } from "../src/seo/catalog";

// The sitemap's card and set entries (api/sitemap.ts fetches the rows). Each
// carries <lastmod> — when one of its listings last changed — because Bing
// asks for the page's real modification time and Google uses lastmod once
// it's consistently accurate.

const BOWMASTERS = "ea5103f5-27e0-4eb1-902c-7f34652d6bf3";
const SOL_RING = "6ad8011d-3471-4369-9d68-b264cc027487";

function row(overrides: Partial<SitemapInventoryRow>): SitemapInventoryRow {
  return {
    card_name: "Orcish Bowmasters",
    oracle_id: BOWMASTERS,
    set_code: "LTR",
    quantity: 1,
    updated_at: "2026-10-01T12:00:00+00:00",
    ...overrides,
  };
}

/** The <loc> and <lastmod> of each entry. */
function read(entries: string[]): [string, string | null][] {
  return entries.map((entry) => [
    /<loc>([^<]+)<\/loc>/.exec(entry)?.[1] ?? "?",
    /<lastmod>([^<]+)<\/lastmod>/.exec(entry)?.[1] ?? null,
  ]);
}

describe("the sitemap's card pages", () => {
  it("list each card in stock once, dated by the latest change to any of its copies", () => {
    const entries = catalogEntries(
      [
        row({ updated_at: "2026-10-01T12:00:00+00:00" }),
        // Another copy of the same card that just sold down to none: the page changed then.
        row({ quantity: 0, updated_at: "2026-10-07T09:30:15.123456+00:00" }),
        row({ card_name: "Sol Ring", oracle_id: SOL_RING, set_code: "C21", updated_at: "2026-09-25T08:00:00+00:00" }),
      ],
      [],
    );
    expect(read(entries)).toEqual([
      ["https://geega-games.com/shop/card/orcish-bowmasters", "2026-10-07T09:30:15Z"],
      ["https://geega-games.com/shop/card/sol-ring", "2026-09-25T08:00:00Z"],
    ]);
  });

  it("leave out a card with nothing in stock, or with no page to go to", () => {
    const entries = catalogEntries(
      [
        row({ quantity: 0 }),
        row({ card_name: "Sol Ring", oracle_id: null }),
        row({ card_name: "", oracle_id: SOL_RING }),
        row({ card_name: "!!!", oracle_id: "x" }),
      ],
      [],
    );
    expect(entries).toEqual([]);
  });

  it("leave the date out rather than guess it", () => {
    expect(read(catalogEntries([row({ updated_at: null }), row({ updated_at: "not a date" })], []))).toEqual([
      ["https://geega-games.com/shop/card/orcish-bowmasters", null],
    ]);
  });
});

describe("the sitemap's set pages", () => {
  const rows = [
    row({ set_code: "LTR", updated_at: "2026-10-02T00:00:00Z" }),
    row({ card_name: "Sol Ring", oracle_id: SOL_RING, set_code: "LTR", updated_at: "2026-10-05T00:00:00Z" }),
    row({ card_name: "Sol Ring", oracle_id: SOL_RING, set_code: "C21", updated_at: "2026-10-06T00:00:00Z" }),
  ];

  it("list only sets deep enough to be indexed — the rule the set page's own robots tag uses", () => {
    expect(MIN_INDEXABLE_SET_LISTINGS).toBe(2);
    const sets = read(
      catalogEntries(rows, [
        { set_code: "LTR", card_count: 2 },
        { set_code: "C21", card_count: 1 },
      ]),
    ).filter(([loc]) => loc.includes("/shop/set/"));
    expect(sets).toEqual([["https://geega-games.com/shop/set/ltr", "2026-10-05T00:00:00Z"]]);
  });

  it("are left out when the set counts couldn't be read", () => {
    expect(read(catalogEntries(rows, null)).filter(([loc]) => loc.includes("/shop/set/"))).toEqual([]);
  });
});
