import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SET_SUMMARY_LIMIT,
  buildCardPage,
  buildInvalidPage,
  buildSetPage,
  findSet,
  parseCatalogRequest,
  renderCatalogHtml,
  toCardDetail,
  toSetCards,
} from "../api/_lib/catalogPage";
import { renderSeoHead } from "../src/seo/head";
import { fillTemplate, hasHeadMarkers, refillShell } from "../src/seo/template";

// What api/catalog-page.ts decides for a card or set address, and the HTML it
// puts into the app shell. The handler itself (HTTP, caching, the database
// calls) is covered in tests/catalogPageApi.test.ts.

// ---- Reading the address ---------------------------------------------------

describe("parseCatalogRequest", () => {
  const parse = (url: string | undefined, query: Record<string, unknown> = {}) => parseCatalogRequest({ url, query });

  it("reads the card or set from the address the visitor is at", () => {
    expect(parse("/shop/card/sol-ring?kind=card&slug=sol-ring", { kind: "card", slug: "sol-ring" })).toEqual({
      type: "page",
      request: { kind: "card", slug: "sol-ring" },
      source: "path",
    });
    expect(parse("/shop/set/mh2")).toEqual({ type: "page", request: { kind: "set", code: "mh2" }, source: "path" });
  });

  it("can't be talked into describing a different card by the query string", () => {
    const query = { kind: "set", slug: "black-lotus", code: "leb" };
    expect(parse("/shop/card/sol-ring?kind=set&slug=black-lotus&code=leb", query)).toEqual({
      type: "page",
      request: { kind: "card", slug: "sol-ring" },
      source: "path",
    });
  });

  it("falls back to the rewrite's query when the request URL doesn't show the address", () => {
    expect(parse("/api/catalog-page?kind=card&slug=sol-ring", { kind: "card", slug: "sol-ring" })).toEqual({
      type: "page",
      request: { kind: "card", slug: "sol-ring" },
      source: "query",
    });
    expect(parse(undefined, { kind: "set", code: "fin" })).toEqual({
      type: "page",
      request: { kind: "set", code: "fin" },
      source: "query",
    });
    // A repeated parameter arrives as a list; the first value is used.
    expect(parse(undefined, { kind: ["card", "set"], slug: ["sol-ring", "x"] })).toMatchObject({
      request: { kind: "card", slug: "sol-ring" },
    });
  });

  it("sends an upper-case spelling to the real, lower-case address", () => {
    expect(parse("/shop/card/Sol-Ring")).toEqual({ type: "redirect", location: "/shop/card/sol-ring", source: "path" });
    expect(parse("/shop/set/FIN")).toEqual({ type: "redirect", location: "/shop/set/fin", source: "path" });
    expect(parse(undefined, { kind: "set", code: "Mh2" })).toEqual({
      type: "redirect",
      location: "/shop/set/mh2",
      source: "query",
    });
  });

  it("keeps the visitor's own query string across that redirect, but not the rewrite's", () => {
    expect(parse("/shop/card/Sol-Ring?utm_source=newsletter&kind=card&slug=Sol-Ring&ref=a%20b")).toMatchObject({
      type: "redirect",
      location: "/shop/card/sol-ring?utm_source=newsletter&ref=a+b",
    });
    expect(parse(undefined, { kind: "set", code: "FIN", utm_source: "x", tag: ["a", "b"] })).toMatchObject({
      type: "redirect",
      location: "/shop/set/fin?utm_source=x&tag=a&tag=b",
    });
  });

  it("understands a percent-encoded address", () => {
    expect(parse("/shop/card/sol%2Dring")).toMatchObject({ type: "page", request: { kind: "card", slug: "sol-ring" } });
  });

  it("rejects anything that could never be a card slug, without asking the database", () => {
    for (const slug of [
      "sol_ring",
      "sol ring",
      "-sol-ring",
      "sol-ring-",
      "sol--ring",
      "sol.ring",
      "%E0%A4%A", // malformed escape
      "sol%2Fring", // an encoded slash
      "<script>",
      "a".repeat(161),
    ]) {
      expect(parse(`/shop/card/${slug}`), slug).toEqual({ type: "invalid", kind: "card", source: "path" });
    }
    expect(parse(undefined, { kind: "card" })).toEqual({ type: "invalid", kind: "card", source: "query" });
    expect(parse(undefined, { kind: "card", slug: 42 })).toMatchObject({ type: "invalid", kind: "card" });
    // 160 characters is still a slug.
    expect(parse(`/shop/card/${"a".repeat(160)}`).type).toBe("page");
  });

  it("rejects anything that could never be a set code", () => {
    for (const code of ["m-h2", "mh2!", "a".repeat(13), "%20"]) {
      expect(parse(`/shop/set/${code}`), code).toEqual({ type: "invalid", kind: "set", source: "path" });
    }
    expect(parse(undefined, { kind: "set", slug: "mh2" })).toMatchObject({ type: "invalid", kind: "set" });
  });

  it("rejects a request that isn't for a card or a set at all", () => {
    expect(parse("/api/catalog-page", {})).toEqual({ type: "invalid", kind: null, source: "query" });
    expect(parse(undefined, { kind: "deck", slug: "x" })).toEqual({ type: "invalid", kind: null, source: "query" });
    expect(parse("/shop/card/a/b", {})).toMatchObject({ type: "invalid", kind: null });
  });
});

// ---- Reading the database's answer -----------------------------------------

// The shape public.get_card_detail returns (trimmed to one real listing).
const DETAIL_JSON = {
  oracleId: "ea5103f5-27e0-4eb1-902c-7f34652d6bf3",
  cardName: "Orcish Bowmasters",
  typeLine: "Creature — Orc Archer",
  oracleText: "Flash\nWhen this creature enters, it deals 1 damage to any target. Then amass Orcs 1.",
  manaCost: "{1}{B}",
  inStockCount: 2,
  minPriceCents: 4100,
  maxPriceCents: 4700,
  listings: [
    {
      id: "07e03967",
      setCode: "LTR",
      setName: "The Lord of the Rings: Tales of Middle-earth",
      collectorNumber: "103",
      condition: "NM",
      finish: "nonfoil",
      variantType: "",
      imageUrl: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299",
      quantity: 1,
      priceCents: 4100,
    },
    {
      id: "c031c54e",
      setCode: "LTR",
      setName: "The Lord of the Rings: Tales of Middle-earth",
      collectorNumber: "433",
      condition: "LP",
      finish: "foil",
      variantType: "Borderless",
      imageUrl: "https://cards.scryfall.io/large/front/d/e/de2de055.jpg?1783916154",
      quantity: 1,
      priceCents: 4700,
    },
  ],
};

describe("toCardDetail", () => {
  it("keeps what a page needs from a real answer", () => {
    const detail = toCardDetail(DETAIL_JSON);
    expect(detail).toMatchObject({
      cardName: "Orcish Bowmasters",
      typeLine: "Creature — Orc Archer",
      inStockCount: 2,
      minPriceCents: 4100,
      maxPriceCents: 4700,
    });
    expect(detail?.listings).toHaveLength(2);
    // An empty string from the database is "nothing", not a label to print.
    expect(detail?.listings[0]).toMatchObject({ setCode: "LTR", variantType: null, priceCents: 4100 });
    expect(detail?.listings[1]).toMatchObject({ finish: "foil", variantType: "Borderless" });
  });

  it("is null when there is no such card, or the answer isn't a card", () => {
    for (const value of [null, undefined, "", 0, [], [DETAIL_JSON], {}, { cardName: "" }, { cardName: 7 }]) {
      expect(toCardDetail(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("tolerates missing or malformed parts instead of failing the page", () => {
    const detail = toCardDetail({ cardName: "Sol Ring", listings: [null, "x", { priceCents: "12" }, { priceCents: 150.4 }] });
    expect(detail).toMatchObject({ cardName: "Sol Ring", inStockCount: 2, minPriceCents: null, typeLine: null });
    expect(detail?.listings).toEqual([
      expect.objectContaining({ condition: "NM", finish: "nonfoil", priceCents: null, imageUrl: null }),
      expect.objectContaining({ priceCents: 150 }),
    ]);
    expect(toCardDetail({ cardName: "Sol Ring", listings: "nope" })?.listings).toEqual([]);
  });
});

describe("findSet and toSetCards", () => {
  const SETS = [
    { set_code: "LEB", set_name: "Limited Edition Beta", card_count: 6, min_price_cents: 328 },
    { set_code: "LTR", set_name: "The Lord of the Rings: Tales of Middle-earth", card_count: 4, min_price_cents: 157 },
  ];

  it("finds a set by its code, whatever the case", () => {
    expect(findSet(SETS, "ltr")).toEqual({
      set_code: "LTR",
      set_name: "The Lord of the Rings: Tales of Middle-earth",
      card_count: 4,
    });
    expect(findSet(SETS, "LEB")?.set_name).toBe("Limited Edition Beta");
  });

  it("is null for a set with nothing in stock, or an answer that isn't a list of sets", () => {
    expect(findSet(SETS, "mh2")).toBeNull();
    for (const rows of [null, undefined, {}, "LTR", [null, 3, { set_code: "LTR" }, { set_name: "No code" }]]) {
      expect(findSet(rows, "ltr")).toBeNull();
    }
  });

  it("reads the in-stock listings of a set", () => {
    expect(
      toSetCards([
        { card_name: "Delighted Halfling", condition: "LP", finish: "nonfoil", price_cents: 2400 },
        { card_name: "", price_cents: 1 },
        null,
        { card_name: "Reprieve" },
      ]),
    ).toEqual([
      { name: "Delighted Halfling", condition: "LP", finish: "nonfoil", priceCents: 2400 },
      { name: "Reprieve", condition: "NM", finish: "nonfoil", priceCents: null },
    ]);
    expect(toSetCards(null)).toEqual([]);
  });
});

// ---- Deciding the page -----------------------------------------------------

describe("buildCardPage", () => {
  const page = buildCardPage("orcish-bowmasters", toCardDetail(DETAIL_JSON));

  it("answers 200 with the card's own tags", () => {
    expect(page.status).toBe(200);
    expect(page.seo.title).toBe("Orcish Bowmasters — Buy Magic: The Gathering Singles | Geega Games");
    expect(page.seo.path).toBe("/shop/card/orcish-bowmasters");
    expect(page.seo.noIndex).toBe(false);
    expect(page.seo.image?.url).toBe("https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299");
  });

  it("summarises the card for readers without JavaScript", () => {
    const html = page.summaryHtml;
    expect(html.startsWith('<noscript><div class="gg-page">')).toBe(true);
    expect(html.endsWith("</div></noscript>")).toBe(true);
    expect(html).toContain("<h1>Orcish Bowmasters</h1>");
    expect(html).toContain("<p>Creature — Orc Archer</p>");
    expect(html).toContain("<p>Flash<br />When this creature enters");
    expect(html).toContain("<strong>$41.00 – $47.00 · 2 listings in stock</strong>");
    expect(html).toContain(
      "<li>The Lord of the Rings: Tales of Middle-earth · #103 · Near Mint · $41.00</li>",
    );
    expect(html).toContain(
      "<li>The Lord of the Rings: Tales of Middle-earth · #433 · Lightly Played · foil · Borderless · $47.00</li>",
    );
  });

  it("links to the set page once per set, and to the shop", () => {
    const html = page.summaryHtml;
    expect(html.match(/href="\/shop\/set\/ltr"/g)).toHaveLength(1);
    expect(html).toContain('<a href="/shop/set/ltr">More from The Lord of the Rings: Tales of Middle-earth</a>');
    expect(html).toContain('<a href="/shop">All Magic: The Gathering singles</a>');
  });

  it("shows one price, not a range, when every listing costs the same", () => {
    const detail = toCardDetail({ ...DETAIL_JSON, inStockCount: 1, maxPriceCents: 4100, listings: [DETAIL_JSON.listings[0]] });
    expect(buildCardPage("orcish-bowmasters", detail).summaryHtml).toContain(
      "<strong>$41.00 · 1 listing in stock</strong>",
    );
  });

  it("keeps a sold-out card's page (200) but marks it noindex", () => {
    const soldOut = buildCardPage(
      "orcish-bowmasters",
      toCardDetail({ ...DETAIL_JSON, listings: [], inStockCount: 0, minPriceCents: null, maxPriceCents: null }),
    );
    expect(soldOut.status).toBe(200);
    expect(soldOut.seo.noIndex).toBe(true);
    expect(soldOut.summaryHtml).toContain("<strong>Currently out of stock</strong>");
    expect(soldOut.summaryHtml).not.toContain("<ul>");
    expect(soldOut.summaryHtml).not.toContain("/shop/set/");
  });

  it("answers 404 when there is no such card", () => {
    const missing = buildCardPage("not-a-card", null);
    expect(missing.status).toBe(404);
    expect(missing.seo).toMatchObject({ title: "Card Not Found | Geega Games", path: null, noIndex: true });
    expect(missing.summaryHtml).toContain("<h1>Card not found</h1>");
    expect(missing.summaryHtml).toContain('href="/shop"');
  });

  it("escapes everything that came from the database", () => {
    const hostile = buildCardPage(
      "x",
      toCardDetail({
        cardName: '<script>alert("name")</script>',
        typeLine: "<b>type</b>",
        oracleText: "</noscript><script>alert(1)</script>",
        inStockCount: 1,
        minPriceCents: 100,
        maxPriceCents: 100,
        listings: [
          {
            setCode: 'x"><script>',
            setName: "<i>set</i>",
            collectorNumber: "<u>1</u>",
            condition: "<em>NM</em>",
            finish: "<s>foil</s>",
            variantType: "<a>variant</a>",
            priceCents: 100,
          },
          { setCode: "ok1", setName: '"quoted" & <set>', condition: "NM", finish: "nonfoil", priceCents: 100 },
        ],
      }),
    );
    const html = hostile.summaryHtml;
    expect(html).not.toMatch(/<script|<b>|<i>|<u>|<em>|<s>|<a>variant/);
    expect(html.match(/<\/noscript>/g)).toHaveLength(1);
    expect(html).toContain("&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;");
    // A set code that isn't a real code never becomes a link.
    expect(html).not.toContain('href="/shop/set/x');
    expect(html).toContain('<a href="/shop/set/ok1">More from &quot;quoted&quot; &amp; &lt;set&gt;</a>');
  });
});

describe("buildSetPage", () => {
  const SET = { set_code: "LTR", set_name: "The Lord of the Rings: Tales of Middle-earth", card_count: 4 };
  const CARDS = [
    { name: "Delighted Halfling", condition: "LP", finish: "nonfoil", priceCents: 2400 },
    { name: "Orcish Bowmasters", condition: "NM", finish: "foil", priceCents: 4100 },
    { name: "Shizo, Death's Storehouse", condition: "XX", finish: "nonfoil", priceCents: null },
  ];

  it("answers 200 with the set's tags and a list of its cards, each linked to its own page", () => {
    const page = buildSetPage("ltr", SET, CARDS);
    expect(page.status).toBe(200);
    expect(page.seo.path).toBe("/shop/set/ltr");
    expect(page.seo.title).toContain("Buy The Lord of the Rings: Tales of Middle-earth Singles");
    const html = page.summaryHtml;
    expect(html).toContain("<h1>The Lord of the Rings: Tales of Middle-earth</h1>");
    expect(html).toContain("<p>4 listings in stock.</p>");
    expect(html).toContain('<li><a href="/shop/card/delighted-halfling">Delighted Halfling</a> · Lightly Played · $24.00</li>');
    expect(html).toContain('<li><a href="/shop/card/orcish-bowmasters">Orcish Bowmasters</a> · Near Mint · foil · $41.00</li>');
    // The link uses the same slug rule as the database; an unknown condition code is shown as it is.
    expect(html).toContain('<li><a href="/shop/card/shizo-death-s-storehouse">Shizo, Death\'s Storehouse</a> · XX</li>');
    expect(html).toContain('<a href="/shop/sets">Browse all sets</a>');
  });

  it("still stands without the card list", () => {
    const page = buildSetPage("ltr", { ...SET, card_count: 1 }, []);
    expect(page.status).toBe(200);
    expect(page.summaryHtml).toContain("<p>1 listing in stock.</p>");
    expect(page.summaryHtml).not.toContain("<ul>");
  });

  it("lists at most the first hundred cards", () => {
    const many = Array.from({ length: SET_SUMMARY_LIMIT + 25 }, (_, i) => ({
      name: `Card ${i}`,
      condition: "NM",
      finish: "nonfoil",
      priceCents: 100,
    }));
    expect(buildSetPage("ltr", SET, many).summaryHtml.match(/<li>/g)).toHaveLength(SET_SUMMARY_LIMIT);
  });

  it("answers 404 when nothing from the set is in stock", () => {
    const missing = buildSetPage("zzz", null, []);
    expect(missing.status).toBe(404);
    expect(missing.seo).toMatchObject({ title: "Set Not Found | Geega Games", path: null, noIndex: true });
    expect(missing.summaryHtml).toContain("<h1>Set not found</h1>");
  });

  it("escapes names from the database, and doesn't link a name with no usable slug", () => {
    const page = buildSetPage("ltr", { ...SET, set_name: "<b>Set</b>" }, [
      { name: "<img src=x onerror=alert(1)>", condition: "NM", finish: "<i>foil</i>", priceCents: 100 },
      { name: "!!!", condition: "NM", finish: "nonfoil", priceCents: 100 },
    ]);
    expect(page.summaryHtml).not.toMatch(/<img|<b>|<i>/);
    expect(page.summaryHtml).toContain("<li>!!! · Near Mint · $1.00</li>");
  });
});

describe("buildInvalidPage", () => {
  it("is the same “not found” a well-formed address gets", () => {
    expect(buildInvalidPage("card")).toEqual(buildCardPage("", null));
    expect(buildInvalidPage("set")).toEqual(buildSetPage("", null, []));
    expect(buildInvalidPage(null)).toMatchObject({
      status: 404,
      seo: { title: "Page Not Found | Geega Games", path: null, noIndex: true },
    });
  });
});

// ---- Writing it into the shell ---------------------------------------------

// The real template, filled the way scripts/prerender.ts fills dist/spa.html
// (the built one also has Vite's script and stylesheet tags, added here).
const TEMPLATE = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(
  "</head>",
  '  <script type="module" crossorigin src="/assets/index-AbC123.js"></script>\n  </head>',
);
const SHELL = fillTemplate(TEMPLATE, renderSeoHead(null), "");

describe("renderCatalogHtml", () => {
  const html = renderCatalogHtml(SHELL, buildCardPage("orcish-bowmasters", toCardDetail(DETAIL_JSON)));

  it("starts from a shell that is itself complete", () => {
    expect(hasHeadMarkers(SHELL)).toBe(true);
    expect(SHELL).toContain('<div id="root"></div>');
    expect(SHELL).not.toContain('rel="canonical"');
  });

  it("replaces the shell's neutral tags with the page's own — one of each", () => {
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain("<title>Orcish Bowmasters — Buy Magic: The Gathering Singles | Geega Games</title>");
    expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html.match(/name="twitter:image"/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html.match(/name="robots"/g)).toHaveLength(1);
    // The site-wide picture is gone from the share tags (the card's own replaced it).
    expect(html).not.toContain('property="og:image" content="https://geega-games.com/og-image.png"');
    expect(SHELL).toContain('property="og:image" content="https://geega-games.com/og-image.png"');
  });

  it("leaves the rest of the shell exactly as it was, so the app starts as before", () => {
    expect(html).toContain('<script type="module" crossorigin src="/assets/index-AbC123.js"></script>');
    expect(html).toContain('<meta property="og:site_name" content="Geega Games" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    const outsideHead = (page: string) => page.slice(page.indexOf("<!--/seo-head-->"));
    expect(outsideHead(html).replace(/<div id="root">.*<\/div>\n/s, '<div id="root"></div>\n')).toBe(outsideHead(SHELL));
  });

  it("puts the summary inside the app's root, where the app replaces it on start", () => {
    expect(html).toMatch(/<div id="root"><noscript><div class="gg-page"><h1>Orcish Bowmasters<\/h1>.*<\/div><\/noscript><\/div>/s);
  });

  it("can be filled again for another page (the shell is kept between requests)", () => {
    const again = renderCatalogHtml(SHELL, buildSetPage("zzz", null, []));
    expect(again).toContain("<title>Set Not Found | Geega Games</title>");
    expect(again).not.toContain("Orcish Bowmasters");
    expect(again).not.toContain('rel="canonical"');
    expect(again).not.toContain('property="og:url"');
  });

  it("writes text with a “$” in it literally", () => {
    const page = buildCardPage("x", toCardDetail({ ...DETAIL_JSON, cardName: "Costs $& or $1 — $$" }));
    expect(renderCatalogHtml(SHELL, page)).toContain("<h1>Costs $&amp; or $1 — $$</h1>");
    expect(renderCatalogHtml(SHELL, page)).toContain("<title>Costs $&amp; or $1 — $$ — Buy Magic");
  });
});

describe("the shared template helpers", () => {
  it("recognise a fillable shell by its two head markers, in order", () => {
    expect(hasHeadMarkers("<head><!--seo-head--><title>x</title><!--/seo-head--></head>")).toBe(true);
    expect(hasHeadMarkers("<html><body>Sign in to continue</body></html>")).toBe(false);
    expect(hasHeadMarkers("<!--/seo-head--><!--seo-head-->")).toBe(false);
    expect(hasHeadMarkers("<!--seo-head-->")).toBe(false);
  });

  it("move React's leading resource hints into the head when prerendering", () => {
    const filled = fillTemplate(
      "<head><!--seo-head-->old<!--/seo-head--></head><body><div id=\"root\"><!--app-html--></div></body>",
      "<title>New</title>",
      '<link rel="preload" as="image" href="/logo.png"/><main>Page</main>',
    );
    expect(filled).toContain('<title>New</title>\n    <link rel="preload" as="image" href="/logo.png"/>');
    expect(filled).toContain('<div id="root"><main>Page</main></div>');
    expect(filled).not.toContain("old");
  });

  it("leave the root empty when a shell is refilled without markup", () => {
    const shell = '<head><!--seo-head-->old<!--/seo-head--></head><body><div id="root"></div></body>';
    expect(refillShell(shell, "<title>New</title>")).toContain('<div id="root"></div>');
    expect(refillShell(shell, "<title>New</title>", "<p>Hi</p>")).toContain('<div id="root"><p>Hi</p></div>');
  });
});
