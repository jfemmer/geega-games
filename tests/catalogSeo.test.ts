import { describe, expect, it } from "vitest";
import {
  LISTING_CONDITION,
  MIN_INDEXABLE_SET_LISTINGS,
  cardPagePath,
  cardPageSeo,
  finishName,
  isIndexableSet,
  listingName,
  listingPagePath,
  readListingId,
  setPagePath,
  setPageSeo,
  withSelectedFirst,
  type CatalogCardDetail,
} from "../src/seo/catalog";
import { PAGE_JSON_LD_ATTR, renderSeoHead } from "../src/seo/head";
import { DEFAULT_OG_IMAGE } from "../src/seo/site";

// The tags for a card page (/shop/card/:slug) and a set page (/shop/set/:code).
// One set of builders (src/seo/catalog.ts) feeds both the server
// (api/catalog-page.ts writes them into the HTML) and the browser (the React
// pages hand them to useSEO), so what a crawler reads and what the app shows
// can't drift apart.

const NM_ID = "07e03967-5c4a-4f0e-9d1b-2a7c1f0e9b11";
const FOIL_ID = "c031c54e-8b7d-4a52-a0e3-6f2d9c4b7a22";
const LTR = "The Lord of the Rings: Tales of Middle-earth";

const BOWMASTERS: CatalogCardDetail = {
  oracleId: "ea5103f5-27e0-4eb1-902c-7f34652d6bf3",
  cardName: "Orcish Bowmasters",
  typeLine: "Creature — Orc Archer",
  inStockCount: 2,
  minPriceCents: 4100,
  maxPriceCents: 4700,
  listings: [
    {
      id: NM_ID,
      setCode: "LTR",
      setName: LTR,
      collectorNumber: "103",
      condition: "NM",
      finish: "nonfoil",
      variantType: null,
      imageUrl: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299",
      priceCents: 4100,
    },
    {
      id: FOIL_ID,
      setCode: "LTR",
      setName: LTR,
      collectorNumber: "433",
      condition: "LP",
      finish: "foil",
      variantType: "Borderless",
      // An older row saved at Scryfall's "normal" size.
      imageUrl: "https://cards.scryfall.io/normal/front/d/e/de2de055.jpg?1783916154",
      priceCents: 4700,
    },
  ],
};

/** Bowmasters with only its cheapest listing in stock. */
const ONE_LISTING: CatalogCardDetail = {
  ...BOWMASTERS,
  inStockCount: 1,
  maxPriceCents: 4100,
  listings: [BOWMASTERS.listings[0]],
};

const SOLD_OUT: CatalogCardDetail = {
  cardName: "Black Lotus",
  typeLine: "Artifact",
  inStockCount: 0,
  minPriceCents: null,
  maxPriceCents: null,
  listings: [],
};

type JsonLd = Record<string, unknown>;
const jsonLdOf = (seo: { jsonLd?: object | object[] }) => (Array.isArray(seo.jsonLd) ? seo.jsonLd : [seo.jsonLd]) as JsonLd[];

describe("card page tags", () => {
  it("names the card, its price and how many listings are in stock", () => {
    const seo = cardPageSeo("orcish-bowmasters", BOWMASTERS);
    expect(seo.title).toBe("Orcish Bowmasters — Buy Magic: The Gathering Singles | Geega Games");
    expect(seo.description).toBe(
      "Buy Orcish Bowmasters — Creature — Orc Archer · From $41.00 · 2 listings in stock. Honest condition grading, secure checkout, and fast shipping from Geega Games.",
    );
    expect(seo.path).toBe("/shop/card/orcish-bowmasters");
    expect(seo.noIndex).toBe(false);
  });

  it("says “1 listing”, and leaves the type line out when there isn't one", () => {
    const seo = cardPageSeo("x", { ...BOWMASTERS, typeLine: null, inStockCount: 1, listings: [BOWMASTERS.listings[0]] });
    expect(seo.description).toContain("Buy Orcish Bowmasters — From $41.00 · 1 listing in stock.");
  });

  it("uses the cheapest listing's picture as the share preview, at Scryfall's large size", () => {
    expect(cardPageSeo("orcish-bowmasters", BOWMASTERS).image).toEqual({
      url: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299",
      width: 672,
      height: 936,
      alt: "Orcish Bowmasters",
    });

    // An older row saved at the "normal" size is upgraded, like on the page itself.
    const normal = cardPageSeo("x", {
      ...BOWMASTERS,
      listings: [{ imageUrl: "https://cards.scryfall.io/normal/front/7/c/7c024bae.jpg?1" }],
    });
    expect(normal.image).toMatchObject({ url: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1", width: 672 });

    // Any other picture is used as it is, with no size claimed for it.
    const other = cardPageSeo("x", { ...BOWMASTERS, listings: [{ imageUrl: "https://example.com/card.png" }] });
    expect(other.image).toEqual({ url: "https://example.com/card.png", alt: "Orcish Bowmasters" });
  });

  it("describes a card with one listing as a product with a single offer", () => {
    const [breadcrumbs, product] = jsonLdOf(cardPageSeo("orcish-bowmasters", ONE_LISTING));
    expect(breadcrumbs).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Shop", item: "https://geega-games.com/shop" },
        { position: 2, name: "Orcish Bowmasters", item: "https://geega-games.com/shop/card/orcish-bowmasters" },
      ],
    });
    expect(product).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Orcish Bowmasters",
      description: "Creature — Orc Archer",
      image: ["https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299"],
      sku: NM_ID,
      category: "Trading Card",
      brand: { "@type": "Brand", name: "Magic: The Gathering" },
      offers: {
        "@type": "Offer",
        // The listing's own address, which opens the page with it chosen.
        url: `https://geega-games.com/shop/card/orcish-bowmasters?listing=${NM_ID}`,
        // A number, not "41.00": what Google's merchant listings ask for.
        price: 41,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
      },
    });
  });

  it("describes a card with several listings as one product group, each listing a variant with its own offer", () => {
    const [, group] = jsonLdOf(cardPageSeo("orcish-bowmasters", BOWMASTERS));
    expect(group).toMatchObject({
      "@type": "ProductGroup",
      name: "Orcish Bowmasters",
      description: "Creature — Orc Archer",
      // The page without a listing chosen.
      url: "https://geega-games.com/shop/card/orcish-bowmasters",
      productGroupID: "ea5103f5-27e0-4eb1-902c-7f34652d6bf3",
      brand: { "@type": "Brand", name: "Magic: The Gathering" },
    });
    const variants = group.hasVariant as JsonLd[];
    expect(variants).toHaveLength(2);
    expect(variants[1]).toEqual({
      "@type": "Product",
      name: `Orcish Bowmasters — ${LTR} #433, Lightly Played, Foil, Borderless`,
      // Each variant shows its own printing, at the large size.
      image: ["https://cards.scryfall.io/large/front/d/e/de2de055.jpg?1783916154"],
      sku: FOIL_ID,
      offers: {
        "@type": "Offer",
        url: `https://geega-games.com/shop/card/orcish-bowmasters?listing=${FOIL_ID}`,
        price: 47,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/UsedCondition",
      },
    });
    expect(variants[0]).toMatchObject({
      name: `Orcish Bowmasters — ${LTR} #103, Near Mint`,
      sku: NM_ID,
      offers: { price: 41 },
    });
  });

  it("never states a price range: Google's merchant listings can't read an AggregateOffer", () => {
    for (const detail of [ONE_LISTING, BOWMASTERS]) {
      expect(JSON.stringify(cardPageSeo("orcish-bowmasters", detail).jsonLd)).not.toContain("AggregateOffer");
    }
  });

  it("offers only listings that can be bought: with an id for the cart and a real price", () => {
    const seo = cardPageSeo("orcish-bowmasters", {
      ...BOWMASTERS,
      listings: [
        { ...BOWMASTERS.listings[0], id: null },
        { ...BOWMASTERS.listings[1], priceCents: 0 },
        { ...BOWMASTERS.listings[1], id: "x", priceCents: null },
        { ...BOWMASTERS.listings[1], priceCents: 45.5 },
      ],
    });
    // Nothing for sale in the markup, though the page is still in stock.
    expect(jsonLdOf(seo)).toHaveLength(1);
    expect(seo.noIndex).toBe(false);

    const oneSellable = cardPageSeo("orcish-bowmasters", {
      ...BOWMASTERS,
      listings: [{ ...BOWMASTERS.listings[0], id: null }, BOWMASTERS.listings[1]],
    });
    expect(jsonLdOf(oneSellable)[1]).toMatchObject({ "@type": "Product", sku: FOIL_ID, offers: { price: 47 } });
  });

  it("states prices to the cent", () => {
    const cheap = cardPageSeo("x", { ...ONE_LISTING, listings: [{ ...BOWMASTERS.listings[0], priceCents: 1999 }] });
    expect((jsonLdOf(cheap)[1].offers as JsonLd).price).toBe(19.99);
  });

  it("describes every listing in the condition the product feed uses", () => {
    expect(LISTING_CONDITION).toBe("used");
    const product = jsonLdOf(cardPageSeo("x", ONE_LISTING))[1];
    expect((product.offers as JsonLd).itemCondition).toBe("https://schema.org/UsedCondition");
  });

  it("keeps a sold-out card's page but asks search engines not to index it", () => {
    const seo = cardPageSeo("black-lotus", SOLD_OUT);
    expect(seo.noIndex).toBe(true);
    expect(seo.path).toBe("/shop/card/black-lotus");
    expect(seo.description).toContain("Buy Black Lotus — Artifact · Currently out of stock.");
    expect(seo.image).toBeUndefined();
    // Nothing is for sale, so there's no product to describe — no zero-price offer.
    expect(jsonLdOf(seo)).toEqual([expect.objectContaining({ "@type": "BreadcrumbList" })]);
  });

  it("says so when there is no such card, and claims no address for it", () => {
    const seo = cardPageSeo("not-a-card", null);
    expect(seo).toEqual({
      title: "Card Not Found | Geega Games",
      description: expect.stringContaining("isn't currently listed"),
      path: null,
      noIndex: true,
    });
  });

  it("builds links from the origin it's given", () => {
    const [breadcrumbs, group] = jsonLdOf(cardPageSeo("orcish-bowmasters", BOWMASTERS, "https://preview.example"));
    expect(JSON.stringify(breadcrumbs)).toContain("https://preview.example/shop/card/orcish-bowmasters");
    expect(group.url).toBe("https://preview.example/shop/card/orcish-bowmasters");
    const offer = (group.hasVariant as JsonLd[])[0].offers as JsonLd;
    expect(offer.url).toBe(`https://preview.example/shop/card/orcish-bowmasters?listing=${NM_ID}`);
  });

  it("falls back to the card's address as the group id when there's no oracle id", () => {
    const [, group] = jsonLdOf(cardPageSeo("orcish-bowmasters", { ...BOWMASTERS, oracleId: null }));
    expect(group.productGroupID).toBe("orcish-bowmasters");
  });
});

describe("a listing's own address", () => {
  it("is the card's page with the listing chosen", () => {
    expect(listingPagePath("sol-ring", NM_ID)).toBe(`/shop/card/sol-ring?listing=${NM_ID}`);
  });

  it("is read only when it names a listing id", () => {
    expect(readListingId(NM_ID)).toBe(NM_ID);
    expect(readListingId(` ${NM_ID.toUpperCase()} `)).toBe(NM_ID);
    for (const junk of [null, undefined, "", "1", "07e03967", `${NM_ID}x`, "<script>", `${NM_ID}&x=1`]) {
      expect(readListingId(junk), String(junk)).toBeNull();
    }
  });

  it("puts that listing first and leaves the rest in order", () => {
    const listings = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(withSelectedFirst(listings, "c").map((l) => l.id)).toEqual(["c", "a", "b"]);
    expect(withSelectedFirst(listings, "a")).toBe(listings);
    // A listing that has since sold: the page is shown as it is.
    expect(withSelectedFirst(listings, "gone")).toBe(listings);
    expect(withSelectedFirst(listings, null)).toBe(listings);
    expect(listings.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("a listing's name", () => {
  it("says what tells it from the card's other listings", () => {
    expect(listingName("Orcish Bowmasters", BOWMASTERS.listings[1])).toBe(
      `Orcish Bowmasters — ${LTR} #433, Lightly Played, Foil, Borderless`,
    );
    expect(listingName("Sol Ring", { imageUrl: null })).toBe("Sol Ring");
    expect(listingName("Sol Ring", { imageUrl: null, setCode: "c21", condition: "XX" })).toBe("Sol Ring — C21, XX");
  });

  it("names special foils as foils", () => {
    expect(finishName("nonfoil")).toBeNull();
    expect(finishName(undefined)).toBeNull();
    expect(finishName("foil")).toBe("Foil");
    expect(finishName("etched")).toBe("Etched Foil");
    expect(finishName("surge")).toBe("Surge Foil");
    expect(finishName("glossy")).toBe("Glossy");
  });
});

describe("set page tags", () => {
  it("names the set and lives at the lower-case code", () => {
    const seo = setPageSeo("LTR", { set_name: "The Lord of the Rings: Tales of Middle-earth" });
    expect(seo.title).toBe(
      "Buy The Lord of the Rings: Tales of Middle-earth Singles — Magic: The Gathering | Geega Games",
    );
    expect(seo.description).toContain("singles from The Lord of the Rings: Tales of Middle-earth at Geega Games");
    expect(seo.path).toBe("/shop/set/ltr");
    expect(seo.noIndex).toBeFalsy();
    expect(seo.jsonLd).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Shop by set", item: "https://geega-games.com/shop/sets" },
        { position: 2, name: "The Lord of the Rings: Tales of Middle-earth", item: "https://geega-games.com/shop/set/ltr" },
      ],
    });
  });

  it("asks not to be indexed while only one listing from the set is in stock", () => {
    // With one card on it, the page only repeats that card's page. The sitemap
    // leaves it out by the same rule (tests/sitemapCatalog.test.ts).
    expect(MIN_INDEXABLE_SET_LISTINGS).toBe(2);
    const thin = setPageSeo("ltr", { set_name: LTR, card_count: 1 });
    expect(thin.noIndex).toBe(true);
    expect(thin.path).toBe("/shop/set/ltr");
    expect(setPageSeo("ltr", { set_name: LTR, card_count: 2 }).noIndex).toBe(false);
    expect(setPageSeo("ltr", { set_name: LTR, card_count: 40 }).noIndex).toBe(false);
    expect(isIndexableSet(undefined)).toBe(true);
    expect(isIndexableSet(0)).toBe(false);
  });

  it("says so when nothing from the set is in stock, and claims no address for it", () => {
    expect(setPageSeo("zzz", null)).toEqual({
      title: "Set Not Found | Geega Games",
      description: expect.stringContaining("don't have any cards from that set"),
      path: null,
      noIndex: true,
    });
  });
});

describe("page addresses", () => {
  it("are built in one place", () => {
    expect(cardPagePath("sol-ring")).toBe("/shop/card/sol-ring");
    expect(setPagePath("MH2")).toBe("/shop/set/mh2");
  });
});

describe("the head tags a card page is served with", () => {
  const head = renderSeoHead(cardPageSeo("orcish-bowmasters", BOWMASTERS));

  it("carry the page's own title, address and share-preview picture", () => {
    expect(head).toContain("<title>Orcish Bowmasters — Buy Magic: The Gathering Singles | Geega Games</title>");
    expect(head).toContain('<link rel="canonical" href="https://geega-games.com/shop/card/orcish-bowmasters" />');
    expect(head).toContain('<meta property="og:url" content="https://geega-games.com/shop/card/orcish-bowmasters" />');
    expect(head).toContain('<meta name="robots" content="index, follow" />');
    expect(head).toContain(
      '<meta property="og:image" content="https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299" />',
    );
    expect(head).toContain('<meta property="og:image:width" content="672" />');
    expect(head).toContain('<meta property="og:image:height" content="936" />');
    expect(head).toContain('<meta property="og:image:alt" content="Orcish Bowmasters" />');
    expect(head).toContain(
      '<meta name="twitter:image" content="https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299" />',
    );
    expect(head).toContain(`<script type="application/ld+json" ${PAGE_JSON_LD_ATTR}>`);
  });

  it("fall back to the site's own picture when a page has none", () => {
    const plain = renderSeoHead({ title: "T", description: "D", path: "/about" });
    expect(plain).toContain(`<meta property="og:image" content="${DEFAULT_OG_IMAGE.url}" />`);
    expect(plain).toContain('<meta property="og:image:width" content="1200" />');
    expect(plain).toContain('<meta property="og:image:height" content="630" />');
    expect(plain).not.toContain("og:image:alt");
    expect(plain).toContain(`<meta name="twitter:image" content="${DEFAULT_OG_IMAGE.url}" />`);
  });

  it("leave the picture's size out unless both numbers are real", () => {
    const seo = { title: "T", description: "D", path: "/x" };
    for (const image of [
      { url: "https://example.com/a.png" },
      { url: "https://example.com/a.png", width: 600 },
      { url: "https://example.com/a.png", width: 0, height: 400 },
      { url: "https://example.com/a.png", width: 1.5, height: 400 },
    ]) {
      const html = renderSeoHead({ ...seo, image });
      expect(html).toContain('<meta property="og:image" content="https://example.com/a.png" />');
      expect(html).not.toContain("og:image:width");
      expect(html).not.toContain("og:image:height");
    }
  });

  it("say “not found” without a canonical address, and ask not to be indexed", () => {
    const notFound = renderSeoHead(cardPageSeo("not-a-card", null));
    expect(notFound).toContain("<title>Card Not Found | Geega Games</title>");
    expect(notFound).toContain('<meta name="robots" content="noindex, follow" />');
    expect(notFound).not.toContain("canonical");
    expect(notFound).not.toContain("og:url");
    expect(notFound).not.toContain(PAGE_JSON_LD_ATTR);
  });

  it("can't be broken out of by a card's name", () => {
    const hostile = cardPageSeo("x", {
      ...BOWMASTERS,
      cardName: 'Evil "</title></script><script>alert(1)</script>',
      typeLine: "<img src=x onerror=alert(1)>",
      listings: [{ imageUrl: 'https://example.com/a.png"><script>alert(2)</script>' }],
    });
    const html = renderSeoHead(hostile);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('a.png">');
    expect(html.match(/<\/title>/g)).toHaveLength(1);
    // Two JSON-LD blocks (the site's and the page's), each closed exactly once.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });
});
