import { describe, expect, it } from "vitest";
import {
  cardPagePath,
  cardPageSeo,
  setPagePath,
  setPageSeo,
  type CatalogCardDetail,
} from "../src/seo/catalog";
import { PAGE_JSON_LD_ATTR, renderSeoHead } from "../src/seo/head";
import { DEFAULT_OG_IMAGE } from "../src/seo/site";

// The tags for a card page (/shop/card/:slug) and a set page (/shop/set/:code).
// One set of builders (src/seo/catalog.ts) feeds both the server
// (api/catalog-page.ts writes them into the HTML) and the browser (the React
// pages hand them to useSEO), so what a crawler reads and what the app shows
// can't drift apart.

const BOWMASTERS: CatalogCardDetail = {
  cardName: "Orcish Bowmasters",
  typeLine: "Creature — Orc Archer",
  inStockCount: 2,
  minPriceCents: 4100,
  maxPriceCents: 4700,
  listings: [
    { imageUrl: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299" },
    { imageUrl: "https://cards.scryfall.io/large/front/d/e/de2de055.jpg?1783916154" },
  ],
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

  it("describes the card to search engines as a product with a price range", () => {
    const [breadcrumbs, product] = jsonLdOf(cardPageSeo("orcish-bowmasters", BOWMASTERS));
    expect(breadcrumbs).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Shop", item: "https://geega-games.com/shop" },
        { position: 2, name: "Orcish Bowmasters", item: "https://geega-games.com/shop/card/orcish-bowmasters" },
      ],
    });
    expect(product).toMatchObject({
      "@type": "Product",
      name: "Orcish Bowmasters",
      description: "Creature — Orc Archer",
      image: ["https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299"],
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "USD",
        lowPrice: "41.00",
        highPrice: "47.00",
        offerCount: 2,
        availability: "https://schema.org/InStock",
        url: "https://geega-games.com/shop/card/orcish-bowmasters",
      },
    });
  });

  it("keeps a sold-out card's page but asks search engines not to index it", () => {
    const seo = cardPageSeo("black-lotus", SOLD_OUT);
    expect(seo.noIndex).toBe(true);
    expect(seo.path).toBe("/shop/card/black-lotus");
    expect(seo.description).toContain("Buy Black Lotus — Artifact · Currently out of stock.");
    expect(seo.image).toBeUndefined();
    const product = jsonLdOf(seo)[1];
    expect(product.offers).toMatchObject({ "@type": "Offer", availability: "https://schema.org/OutOfStock" });
    expect(product).not.toHaveProperty("image");
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
    const [breadcrumbs, product] = jsonLdOf(cardPageSeo("orcish-bowmasters", BOWMASTERS, "https://preview.example"));
    expect(JSON.stringify(breadcrumbs)).toContain("https://preview.example/shop/card/orcish-bowmasters");
    expect((product.offers as JsonLd).url).toBe("https://preview.example/shop/card/orcish-bowmasters");
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
