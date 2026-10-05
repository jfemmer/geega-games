// SEO metadata for the catalog's data-driven pages: one page per card
// (/shop/card/:slug) and one per set (/shop/set/:code).
//
// Two callers build the same tags from these functions, so they can't drift:
//   * the React pages (CardDetailPage, ShopSetPage), through useSEO; and
//   * the catalog function (api/catalog-page.ts), which writes them into the
//     HTML before any JavaScript runs — what crawlers and link previews read.
// Pure module — no React, no DOM, no import.meta.env.

import { isScryfallImageAtSize, storefrontImageUrl } from "../store/lib/cardImages.js";
import { formatCents } from "../store/lib/money.js";
import type { PageSEO, SeoImage } from "./head.js";
import { PRODUCTION_ORIGIN, absoluteUrl } from "./site.js";

/** What the SEO tags need from public.get_card_detail (the page uses more). */
export interface CatalogCardDetail {
  cardName: string;
  /** In-stock listings, cheapest first. Empty when the card is sold out. */
  listings: { imageUrl: string | null }[];
  inStockCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  typeLine?: string | null;
}

/** What the SEO tags need from a public.shop_sets_with_counts row. */
export interface CatalogSetInfo {
  set_name: string;
}

export function cardPagePath(slug: string): string {
  return `/shop/card/${slug}`;
}

/** Set pages live at the lower-case code, whatever case the visitor typed. */
export function setPagePath(code: string): string {
  return `/shop/set/${code.toLowerCase()}`;
}

/** "From $4.00 · 2 listings in stock", or that it's sold out. */
function cardDescription(detail: CatalogCardDetail): string {
  const inStock = detail.listings.length > 0;
  const bits: string[] = [];
  if (detail.typeLine) bits.push(detail.typeLine);
  bits.push(inStock ? `From ${formatCents(detail.minPriceCents)}` : "Currently out of stock");
  if (inStock) {
    bits.push(`${detail.inStockCount} listing${detail.inStockCount === 1 ? "" : "s"} in stock`);
  }
  return `Buy ${detail.cardName} — ${bits.join(" · ")}. Honest condition grading, secure checkout, and fast shipping from Geega Games.`;
}

/** The card's own picture as the share preview. Scryfall's "large" size is 672×936. */
function cardImage(detail: CatalogCardDetail): SeoImage | undefined {
  const url = storefrontImageUrl(detail.listings[0]?.imageUrl ?? null);
  if (!url) return undefined;
  return isScryfallImageAtSize(url, "large")
    ? { url, width: 672, height: 936, alt: detail.cardName }
    : { url, alt: detail.cardName };
}

/**
 * Tags for a card page. `detail` null = no such card is listed: the page
 * says so, claims no canonical address and asks not to be indexed. A
 * sold-out card keeps its page (and its "notify me" form) but is not indexed
 * until it's back in stock.
 */
export function cardPageSeo(
  slug: string,
  detail: CatalogCardDetail | null,
  origin: string = PRODUCTION_ORIGIN,
): PageSEO {
  const path = cardPagePath(slug);
  if (!detail) {
    return {
      title: "Card Not Found | Geega Games",
      description:
        "This card isn't currently listed at Geega Games. Browse our full Magic: The Gathering singles catalog instead.",
      path: null,
      noIndex: true,
    };
  }

  const url = absoluteUrl(path, origin);
  const inStock = detail.listings.length > 0;
  const image = cardImage(detail);

  return {
    title: `${detail.cardName} — Buy Magic: The Gathering Singles | Geega Games`,
    description: cardDescription(detail),
    path,
    noIndex: !inStock,
    image,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Shop", item: absoluteUrl("/shop", origin) },
          { "@type": "ListItem", position: 2, name: detail.cardName, item: url },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: detail.cardName,
        description: detail.typeLine || "Magic: The Gathering trading card",
        ...(image ? { image: [image.url] } : {}),
        category: "Trading Card",
        brand: { "@type": "Brand", name: "Magic: The Gathering" },
        offers: inStock
          ? {
              "@type": "AggregateOffer",
              priceCurrency: "USD",
              lowPrice: ((detail.minPriceCents ?? 0) / 100).toFixed(2),
              highPrice: ((detail.maxPriceCents ?? 0) / 100).toFixed(2),
              offerCount: detail.listings.length,
              availability: "https://schema.org/InStock",
              url,
            }
          : {
              "@type": "Offer",
              priceCurrency: "USD",
              price: "0.00",
              availability: "https://schema.org/OutOfStock",
              url,
            },
      },
    ],
  };
}

/**
 * Tags for a set page. `set` null = nothing from that set is in stock: the
 * page says so, claims no canonical address and asks not to be indexed.
 */
export function setPageSeo(
  code: string,
  set: CatalogSetInfo | null,
  origin: string = PRODUCTION_ORIGIN,
): PageSEO {
  if (!set) {
    return {
      title: "Set Not Found | Geega Games",
      description:
        "We don't have any cards from that set in stock right now. Browse every Magic: The Gathering set we carry at Geega Games instead.",
      path: null,
      noIndex: true,
    };
  }

  const path = setPagePath(code);
  const setName = set.set_name;
  return {
    title: `Buy ${setName} Singles — Magic: The Gathering | Geega Games`,
    description: `Shop in-stock Magic: The Gathering singles from ${setName} at Geega Games. Honest condition grading, secure checkout, and fast shipping nationwide.`,
    path,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Shop by set", item: absoluteUrl("/shop/sets", origin) },
        { "@type": "ListItem", position: 2, name: setName, item: absoluteUrl(path, origin) },
      ],
    },
  };
}
