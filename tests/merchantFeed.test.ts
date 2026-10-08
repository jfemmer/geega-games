import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TITLE_LENGTH,
  buildMerchantFeed,
  feedDescription,
  feedTitle,
  toFeedListings,
  type FeedListing,
} from "../api/_lib/merchantFeed";

// The product feed for Google and Microsoft Merchant Center
// (/feeds/products.xml). What's in it is checked against Google's product
// data specification; the handler's behaviour — never a short feed, never
// indexed — is checked at the end.

const NM_ID = "07e03967-5c4a-4f0e-9d1b-2a7c1f0e9b11";
const FOIL_ID = "c031c54e-8b7d-4a52-a0e3-6f2d9c4b7a22";
const SOL_ID = "5e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
const BOWMASTERS = "ea5103f5-27e0-4eb1-902c-7f34652d6bf3";

/** Rows as public.search_inventory returns them. */
const ROWS = [
  {
    id: NM_ID,
    oracle_id: BOWMASTERS,
    card_name: "Orcish Bowmasters",
    set_code: "LTR",
    set_name: "The Lord of the Rings: Tales of Middle-earth",
    collector_number: "103",
    rarity: "rare",
    type_line: "Creature — Orc Archer",
    image_url: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299",
    condition: "NM",
    finish: "nonfoil",
    variant_type: null,
    quantity: 1,
    price_cents: 4100,
  },
  {
    id: FOIL_ID,
    oracle_id: BOWMASTERS,
    card_name: "Orcish Bowmasters",
    set_code: "LTR",
    set_name: "The Lord of the Rings: Tales of Middle-earth",
    collector_number: "433",
    rarity: "rare",
    type_line: "Creature — Orc Archer",
    image_url: "https://cards.scryfall.io/normal/front/d/e/de2de055.jpg?1783916154",
    condition: "LP",
    finish: "foil",
    variant_type: "Borderless",
    quantity: 2,
    price_cents: 4750,
  },
  {
    id: SOL_ID,
    oracle_id: "6ad8011d-3471-4369-9d68-b264cc027487",
    card_name: "Sol Ring",
    set_code: "C21",
    set_name: "Commander 2021",
    collector_number: "263",
    rarity: "uncommon",
    type_line: "Artifact",
    image_url: "https://cards.scryfall.io/large/front/1/2/12345678.jpg?1",
    condition: "MP",
    finish: "nonfoil",
    variant_type: null,
    quantity: 1,
    price_cents: 199,
  },
];

const LISTINGS = toFeedListings(ROWS);

/** The value of one g: attribute in each <item>, in order. */
function values(xml: string, name: string): (string | null)[] {
  return xml
    .split("<item>")
    .slice(1)
    .map((item) => new RegExp(`<g:${name}>([^<]*)</g:${name}>`).exec(item)?.[1] ?? null);
}

describe("the product feed", () => {
  const { xml, summary } = buildMerchantFeed(LISTINGS);

  it("is an RSS 2.0 file in Google's namespace, one item per copy for sale", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">')).toBe(true);
    expect(xml).toContain("<channel>\n    <title>Geega Games</title>\n    <link>https://geega-games.com/</link>");
    expect(xml.trimEnd().endsWith("</channel>\n</rss>")).toBe(true);
    expect(summary).toEqual({ items: 3, withoutImage: 0 });
    expect(values(xml, "id")).toEqual([NM_ID, FOIL_ID, SOL_ID]);
  });

  it("has every attribute Google requires on every item", () => {
    for (const name of ["id", "title", "description", "link", "image_link", "availability", "price"]) {
      expect(values(xml, name).every((value) => value !== null && value !== ""), name).toBe(true);
    }
  });

  it("links each copy to its card's page with that copy chosen, with no tracking parameters", () => {
    expect(values(xml, "link")).toEqual([
      `https://geega-games.com/shop/card/orcish-bowmasters?listing=${NM_ID}`,
      `https://geega-games.com/shop/card/orcish-bowmasters?listing=${FOIL_ID}`,
      `https://geega-games.com/shop/card/sol-ring?listing=${SOL_ID}`,
    ]);
    expect(xml).not.toMatch(/utm_/);
  });

  it("states the price checkout charges, as Google writes prices", () => {
    expect(values(xml, "price")).toEqual(["41.00 USD", "47.50 USD", "1.99 USD"]);
  });

  it("uses each copy's own picture at Scryfall's large size, which clears Google's 500-pixel minimum", () => {
    expect(values(xml, "image_link")).toEqual([
      "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299",
      "https://cards.scryfall.io/large/front/d/e/de2de055.jpg?1783916154",
      "https://cards.scryfall.io/large/front/1/2/12345678.jpg?1",
    ]);
  });

  it("describes singles honestly: used, in stock, no barcode", () => {
    expect(new Set(values(xml, "condition"))).toEqual(new Set(["used"]));
    // With a space: Google accepts it, and it's the value Microsoft documents.
    expect(new Set(values(xml, "availability"))).toEqual(new Set(["in stock"]));
    expect(new Set(values(xml, "identifier_exists"))).toEqual(new Set(["no"]));
    expect(new Set(values(xml, "brand"))).toEqual(new Set(["Magic: The Gathering"]));
    expect(xml).not.toContain("<g:gtin>");
  });

  it("groups the copies of one card as variants, and leaves a card with one copy ungrouped", () => {
    expect(values(xml, "item_group_id")).toEqual([BOWMASTERS, BOWMASTERS, null]);
    expect(values(xml, "item_group_title")).toEqual(["Orcish Bowmasters", "Orcish Bowmasters", null]);
  });

  it("names each copy so it can be told from the card's others", () => {
    expect(values(xml, "title")).toEqual([
      "Orcish Bowmasters — Magic: The Gathering — The Lord of the Rings: Tales of Middle-earth #103, Near Mint",
      "Orcish Bowmasters — Magic: The Gathering — The Lord of the Rings: Tales of Middle-earth #433, Lightly Played, Foil, Borderless",
      "Sol Ring — Magic: The Gathering — Commander 2021 #263, Moderately Played",
    ]);
  });

  it("describes the card itself, with no links or shop talk", () => {
    expect(feedDescription(LISTINGS[1])).toBe(
      "Orcish Bowmasters, a single Magic: The Gathering card (Creature — Orc Archer). Printing: The Lord of the Rings: Tales of Middle-earth #433, rare. Version: Borderless. Condition: Lightly Played. Finish: Foil.",
    );
    for (const description of values(xml, "description")) {
      expect(description).not.toMatch(/https?:|geega|\$|shipping/i);
    }
  });

  it("keeps titles within Google's 150 characters", () => {
    const long: FeedListing = { ...LISTINGS[1], cardName: "Our Market Research Shows That Players Like Really Long Card Names So We Made This Card to Have the Absolute Longest Card Name Ever Elemental" };
    const title = feedTitle(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("Our Market Research Shows")).toBe(true);
  });

  it("escapes names, and drops characters XML can't carry", () => {
    const odd = buildMerchantFeed([
      { ...LISTINGS[2], cardName: "Fish & Chips <Promo>\u0007", typeLine: "Artifact \u0000" },
    ]).xml;
    expect(odd).toContain("<g:title>Fish &amp; Chips &lt;Promo&gt; — Magic: The Gathering —");
    expect(odd.includes("\u0000") || odd.includes("\u0007")).toBe(false);
  });

  it("leaves out what Google would reject: no picture, no price, nothing in stock, no name", () => {
    const listings = toFeedListings([
      ...ROWS,
      { ...ROWS[2], id: "a", price_cents: 0 },
      { ...ROWS[2], id: "b", price_cents: null },
      { ...ROWS[2], id: "c", quantity: 0 },
      { ...ROWS[2], id: "d", card_name: "" },
      { ...ROWS[2], id: null },
      null,
      "x",
    ]);
    expect(listings.map((l) => l.id)).toEqual([NM_ID, FOIL_ID, SOL_ID]);

    const noPicture = buildMerchantFeed([{ ...LISTINGS[2], imageUrl: null }, LISTINGS[0]]);
    expect(noPicture.summary).toEqual({ items: 1, withoutImage: 1 });
    expect(values(noPicture.xml, "id")).toEqual([NM_ID]);
  });

  it("lists a copy once, even if it was read twice", () => {
    expect(buildMerchantFeed([LISTINGS[0], LISTINGS[0]]).summary.items).toBe(1);
  });

  it("is a valid, empty file when nothing is for sale", () => {
    const empty = buildMerchantFeed([]);
    expect(empty.summary.items).toBe(0);
    expect(empty.xml).toContain("<channel>");
    expect(empty.xml).not.toContain("<item>");
  });
});

// ---- The endpoint ------------------------------------------------------------

const db = vi.hoisted(() => ({
  pages: [] as unknown[][],
  failOn: -1,
  calls: [] as Record<string, unknown>[],
}));

vi.mock("../api/_lib/supabasePublic.js", () => ({
  getSupabasePublic: () => ({
    rpc(name: string, args: Record<string, unknown>) {
      return {
        abortSignal: async () => {
          if (name !== "search_inventory") throw new Error(`unexpected rpc ${name}`);
          const page = db.calls.length;
          db.calls.push(args);
          if (page === db.failOn) return { data: null, error: { message: "boom" } };
          return { data: db.pages[page] ?? [], error: null };
        },
      };
    },
  }),
}));

const { default: handler } = await import("../api/merchant-feed");

async function fetchFeed(method = "GET") {
  const reply = { status: 0, headers: {} as Record<string, string>, body: undefined as string | undefined };
  const res = {
    setHeader(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      reply.status = code;
      return res;
    },
    send(body: string) {
      reply.body = body;
      return res;
    },
    end() {
      return res;
    },
  };
  await handler({ method, url: "/feeds/products.xml", headers: {} } as never, res as never);
  return reply;
}

beforeEach(() => {
  db.pages = [];
  db.failOn = -1;
  db.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("GET /feeds/products.xml", () => {
  it("lists every copy for sale, reading the shop's own in-stock list a hundred at a time", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      ...ROWS[2],
      id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    }));
    db.pages = [many, ROWS];
    const res = await fetchFeed();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/xml; charset=utf-8");
    expect(res.headers["x-gg-feed-items"]).toBe("103");
    expect(res.body?.match(/<item>/g)).toHaveLength(103);
    expect(db.calls).toEqual([
      { p_in_stock_only: true, p_sort: "name_asc", p_limit: 100, p_offset: 0 },
      { p_in_stock_only: true, p_sort: "name_asc", p_limit: 100, p_offset: 100 },
    ]);
  });

  it("is for Merchant Center, not search results, and is cached briefly at the edge", async () => {
    db.pages = [ROWS];
    const res = await fetchFeed();
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.headers["cache-control"]).toBe("public, max-age=0, s-maxage=900, stale-while-revalidate=3600");
  });

  it("answers 503, never a short feed, when the inventory can't be read in full", async () => {
    // Merchant Center removes every product missing from a fetched file.
    db.pages = [Array.from({ length: 100 }, (_, i) => ({ ...ROWS[2], id: `id-${i}` })), ROWS];
    db.failOn = 1;
    const res = await fetchFeed();
    expect(res.status).toBe(503);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["retry-after"]).toBe("600");
    expect(res.body).not.toContain("<rss");
  });

  it("answers HEAD without a body, and refuses other methods", async () => {
    db.pages = [ROWS];
    const head = await fetchFeed("HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeUndefined();
    const post = await fetchFeed("POST");
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
  });
});
