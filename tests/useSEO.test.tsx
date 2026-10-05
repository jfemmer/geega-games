// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useSEO } from "../src/store/lib/useSEO";
import { DEFAULT_OG_IMAGE, DEFAULT_SEO } from "../src/seo/site";
import { PAGE_JSON_LD_ATTR, renderSeoHead, type PageSEO } from "../src/seo/head";
import { cardPageSeo, setPageSeo } from "../src/seo/catalog";

function Page({ pending, ...seo }: PageSEO & { pending?: boolean }) {
  useSEO(seo, { pending });
  return null;
}

const FAQ = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] };

function pageJsonLd(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll(`script[${PAGE_JSON_LD_ATTR}]`));
}

const content = (selector: string) => document.head.querySelector(selector)?.getAttribute("content") ?? null;

/** Every tag useSEO looks after, as a crawler would read them. */
function headTags() {
  return {
    title: document.title,
    description: content('meta[name="description"]'),
    robots: content('meta[name="robots"]'),
    canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    ogTitle: content('meta[property="og:title"]'),
    ogDescription: content('meta[property="og:description"]'),
    ogUrl: content('meta[property="og:url"]'),
    ogImage: content('meta[property="og:image"]'),
    ogImageWidth: content('meta[property="og:image:width"]'),
    ogImageHeight: content('meta[property="og:image:height"]'),
    ogImageAlt: content('meta[property="og:image:alt"]'),
    twitterTitle: content('meta[name="twitter:title"]'),
    twitterDescription: content('meta[name="twitter:description"]'),
    twitterImage: content('meta[name="twitter:image"]'),
    pageJsonLd: pageJsonLd().map((el) => JSON.parse(el.text) as unknown),
  };
}

const DEFAULT_TAGS = {
  title: DEFAULT_SEO.title,
  description: DEFAULT_SEO.description,
  robots: "index, follow",
  canonical: null,
  ogUrl: null,
  ogImage: DEFAULT_OG_IMAGE.url,
  ogImageWidth: "1200",
  ogImageHeight: "630",
  ogImageAlt: null,
  twitterImage: DEFAULT_OG_IMAGE.url,
  pageJsonLd: [],
};

const BOWMASTERS = {
  cardName: "Orcish Bowmasters",
  typeLine: "Creature — Orc Archer",
  inStockCount: 1,
  minPriceCents: 4100,
  maxPriceCents: 4100,
  listings: [{ imageUrl: "https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299" }],
};

afterEach(() => {
  cleanup();
  document.head.innerHTML = "";
});

describe("useSEO", () => {
  it("replaces the prerendered page JSON-LD instead of duplicating it", () => {
    // What scripts/prerender.ts leaves in the head of a prerendered page.
    document.head.innerHTML = `<link rel="canonical" href="https://geega-games.com/sell-my-collection" />
      <script type="application/ld+json" ${PAGE_JSON_LD_ATTR}>${JSON.stringify(FAQ)}</script>`;

    render(<Page title="Sell | Geega Games" description="d" path="/sell-my-collection" jsonLd={FAQ} />);

    expect(pageJsonLd()).toHaveLength(1);
    expect(JSON.parse(pageJsonLd()[0].text)).toEqual(FAQ);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  });

  it("sets the page's own tags, then resets to site defaults and drops the canonical on unmount", () => {
    const { unmount } = render(
      <Page title="Kansas City | Geega Games" description="KC" path="/sell-magic-cards/kansas-city" jsonLd={FAQ} />,
    );
    expect(document.title).toBe("Kansas City | Geega Games");
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(
      /\/sell-magic-cards\/kansas-city$/,
    );
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("KC");

    unmount();

    // A page without useSEO (login, checkout…) must not keep claiming the
    // previous page's canonical URL or title.
    expect(document.title).toBe(DEFAULT_SEO.title);
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
    expect(pageJsonLd()).toHaveLength(0);
  });

  it("marks a page noindex only while it's mounted", () => {
    const { unmount } = render(<Page title="t" description="d" path="/shop/card/x" noIndex />);
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    unmount();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index, follow");
  });
});

describe("useSEO — the share-preview picture", () => {
  it("sets a page's own picture with its size and description, and the site's when it has none", () => {
    const image = { url: "https://cards.scryfall.io/large/front/a.jpg", width: 672, height: 936, alt: "Sol Ring" };
    const { rerender, unmount } = render(<Page title="t" description="d" path="/shop/card/sol-ring" image={image} />);
    expect(headTags()).toMatchObject({
      ogImage: image.url,
      ogImageWidth: "672",
      ogImageHeight: "936",
      ogImageAlt: "Sol Ring",
      twitterImage: image.url,
    });

    // A picture whose size isn't known claims none (and drops the last page's).
    rerender(<Page title="t" description="d" path="/x" image={{ url: "https://example.com/b.png" }} />);
    expect(headTags()).toMatchObject({
      ogImage: "https://example.com/b.png",
      ogImageWidth: null,
      ogImageHeight: null,
      ogImageAlt: null,
      twitterImage: "https://example.com/b.png",
    });

    // The same rule the server uses (imageSize): both numbers real, or neither is stated.
    for (const size of [{ width: 600 }, { width: 0, height: 400 }, { width: 1.5, height: 400 }]) {
      rerender(<Page title="t" description="d" path="/x" image={{ url: "https://example.com/c.png", ...size }} />);
      expect(headTags()).toMatchObject({ ogImage: "https://example.com/c.png", ogImageWidth: null, ogImageHeight: null });
    }

    rerender(<Page title="t" description="d" path="/about" />);
    expect(headTags()).toMatchObject({ ogImage: DEFAULT_OG_IMAGE.url, ogImageWidth: "1200", ogImageHeight: "630" });

    unmount();
    expect(headTags()).toMatchObject(DEFAULT_TAGS);
    expect(document.head.querySelectorAll('meta[property="og:image"]')).toHaveLength(1);
  });
});

describe("useSEO — a page with no address of its own", () => {
  it("removes the canonical and og:url (the not-found page must not claim one)", () => {
    document.head.innerHTML = `<link rel="canonical" href="https://geega-games.com/about" />
      <meta property="og:url" content="https://geega-games.com/about" />`;
    render(<Page title="Page Not Found | Geega Games" description="d" path={null} noIndex />);
    expect(headTags()).toMatchObject({
      title: "Page Not Found | Geega Games",
      canonical: null,
      ogUrl: null,
      robots: "noindex, follow",
    });
  });
});

describe("useSEO — a page still loading its data (card and set pages)", () => {
  // What api/catalog-page.ts writes into the HTML for this card.
  const seo = cardPageSeo("orcish-bowmasters", BOWMASTERS);
  const serverHead = renderSeoHead(seo);

  it("leaves the tags the server wrote exactly as they are while it loads", () => {
    document.head.innerHTML = serverHead;
    const before = document.head.innerHTML;

    // While loading, the page only has placeholder values to offer.
    render(<Page {...cardPageSeo("orcish-bowmasters", null)} pending />);

    expect(document.head.innerHTML).toBe(before);
    expect(headTags().title).toBe("Orcish Bowmasters — Buy Magic: The Gathering Singles | Geega Games");
  });

  it("ends up with the very same tags once the card has loaded", () => {
    document.head.innerHTML = serverHead;
    const fromServer = headTags();
    expect(fromServer.canonical).toBe("https://geega-games.com/shop/card/orcish-bowmasters");
    expect(fromServer.ogImage).toBe("https://cards.scryfall.io/large/front/7/c/7c024bae.jpg?1783916299");
    expect(fromServer.pageJsonLd).toHaveLength(1);

    const { rerender } = render(<Page {...cardPageSeo("orcish-bowmasters", null)} pending />);
    rerender(<Page {...seo} />);

    expect(headTags()).toEqual(fromServer);
    // Replaced, not added to: one of each.
    expect(document.head.querySelectorAll("title")).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[property="og:image"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
  });

  it("does the same for a set page", () => {
    const setSeo = setPageSeo("ltr", { set_name: "The Lord of the Rings: Tales of Middle-earth" });
    document.head.innerHTML = renderSeoHead(setSeo);
    const fromServer = headTags();

    const { rerender } = render(<Page {...setPageSeo("ltr", null)} pending />);
    rerender(<Page {...setSeo} />);

    expect(headTags()).toEqual(fromServer);
  });

  it("says “not found” once it knows there is no such card", () => {
    document.head.innerHTML = renderSeoHead(null); // the plain shell
    const { rerender } = render(<Page {...cardPageSeo("nope", null)} pending />);
    expect(document.title).toBe(DEFAULT_SEO.title);

    rerender(<Page {...cardPageSeo("nope", null)} />);
    expect(headTags()).toMatchObject({
      title: "Card Not Found | Geega Games",
      robots: "noindex, follow",
      canonical: null,
      ogUrl: null,
    });
  });

  it("drops the last card's tags while the next card loads, instead of showing them at the new address", () => {
    const { rerender } = render(<Page {...seo} />);
    expect(headTags().canonical).toBe("https://geega-games.com/shop/card/orcish-bowmasters");

    // The visitor follows a link to another card: loading again.
    rerender(<Page {...cardPageSeo("sol-ring", null)} pending />);
    expect(headTags()).toMatchObject(DEFAULT_TAGS);

    rerender(<Page {...cardPageSeo("sol-ring", { ...BOWMASTERS, cardName: "Sol Ring", typeLine: "Artifact" })} />);
    expect(headTags()).toMatchObject({
      title: "Sol Ring — Buy Magic: The Gathering Singles | Geega Games",
      canonical: "https://geega-games.com/shop/card/sol-ring",
      ogImageAlt: "Sol Ring",
    });
    expect(pageJsonLd()).toHaveLength(1);
  });

  it("resets to the site defaults if the visitor leaves before it finishes loading", () => {
    document.head.innerHTML = serverHead;
    const { unmount } = render(<Page {...cardPageSeo("orcish-bowmasters", null)} pending />);
    unmount();
    expect(headTags()).toMatchObject(DEFAULT_TAGS);
  });
});
