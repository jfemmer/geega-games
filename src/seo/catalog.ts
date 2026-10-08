// SEO metadata for the catalog's data-driven pages: one page per card
// (/shop/card/:slug) and one per set (/shop/set/:code).
//
// Two callers build the same tags from these functions, so they can't drift:
//   * the React pages (CardDetailPage, ShopSetPage), through useSEO; and
//   * the catalog function (api/catalog-page.ts), which writes them into the
//     HTML before any JavaScript runs — what crawlers and link previews read.
// The product feed (api/merchant-feed.ts) names listings with the same
// helpers, so a listing reads the same in the feed and on its page.
// Pure module — no React, no DOM, no import.meta.env.

import { isScryfallImageAtSize, storefrontImageUrl } from "../store/lib/cardImages.js";
import { CONDITION_LABELS } from "../store/lib/conditionLabels.js";
import { formatCents } from "../store/lib/money.js";
import type { PageSEO, SeoImage } from "./head.js";
import { PRODUCTION_ORIGIN, absoluteUrl } from "./site.js";

/** One in-stock listing, as the tags need it (the page itself uses more). */
export interface CatalogListing {
  /** The inventory item's id: the listing's SKU, and what ?listing= selects. */
  id?: string | null;
  setCode?: string | null;
  setName?: string | null;
  collectorNumber?: string | null;
  /** NM, LP, MP, HP or DMG. */
  condition?: string;
  /** nonfoil, foil, etched… */
  finish?: string;
  variantType?: string | null;
  imageUrl: string | null;
  /** What the listing sells for now (deals included), in cents. */
  priceCents?: number | null;
}

/** What the SEO tags need from public.get_card_detail (the page uses more). */
export interface CatalogCardDetail {
  /** Identifies the card across every printing: the listings' product group. */
  oracleId?: string | null;
  cardName: string;
  /** In-stock listings, cheapest first. Empty when the card is sold out. */
  listings: CatalogListing[];
  inStockCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  typeLine?: string | null;
}

/** What the SEO tags need from a public.shop_sets_with_counts row. */
export interface CatalogSetInfo {
  set_name: string;
  /** In-stock listings from the set. */
  card_count?: number | null;
}

export function cardPagePath(slug: string): string {
  return `/shop/card/${slug}`;
}

/** Set pages live at the lower-case code, whatever case the visitor typed. */
export function setPagePath(code: string): string {
  return `/shop/set/${code.toLowerCase()}`;
}

// ---- One listing, one address ----------------------------------------------
// A card page lists every in-stock copy of the card (printings, conditions,
// finishes). Search engines and product feeds need an address for each one
// that opens the page with that copy chosen: ?listing=<id>. The canonical
// address stays the card's own page.

/** The query parameter that preselects one listing on a card page. */
export const LISTING_PARAM = "listing";

/** A listing's own address: its card's page, with that listing chosen. */
export function listingPagePath(slug: string, listingId: string): string {
  return `${cardPagePath(slug)}?${LISTING_PARAM}=${encodeURIComponent(listingId)}`;
}

/** Listing ids are inventory_items UUIDs. */
const LISTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The listing a ?listing= value names, or null for anything that isn't a listing id. */
export function readListingId(value: string | null | undefined): string | null {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return LISTING_ID.test(id) ? id : null;
}

/**
 * The listings with `selectedId` first, the rest in their own order (cheapest
 * first). Unchanged when no listing has that id — a link to a copy that has
 * since sold still opens the card's page.
 */
export function withSelectedFirst<T extends { id?: string | null }>(listings: T[], selectedId: string | null): T[] {
  if (!selectedId) return listings;
  const index = listings.findIndex((listing) => listing.id === selectedId);
  if (index <= 0) return listings;
  return [listings[index], ...listings.slice(0, index), ...listings.slice(index + 1)];
}

// ---- Naming a listing -----------------------------------------------------------

/** "Foil", "Etched Foil"… — null for a plain (nonfoil) card. */
export function finishName(finish: string | null | undefined): string | null {
  if (!finish || finish === "nonfoil") return null;
  if (finish === "foil") return "Foil";
  if (finish === "glossy") return "Glossy";
  return `${finish.charAt(0).toUpperCase()}${finish.slice(1)} Foil`;
}

/** "Near Mint", or the code itself when it isn't one we know. */
export function conditionName(condition: string | null | undefined): string | null {
  if (!condition) return null;
  return CONDITION_LABELS[condition] ?? condition;
}

/**
 * What tells one listing of a card from another:
 * "The Lord of the Rings: Tales of Middle-earth #433, Lightly Played, Foil, Borderless".
 */
export function listingDetails(listing: CatalogListing): string {
  const printing = [
    listing.setName ?? listing.setCode?.toUpperCase() ?? null,
    listing.collectorNumber ? `#${listing.collectorNumber}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return [printing || null, conditionName(listing.condition), finishName(listing.finish), listing.variantType ?? null]
    .filter(Boolean)
    .join(", ");
}

/** "Orcish Bowmasters — The Lord of the Rings: Tales of Middle-earth #103, Near Mint". */
export function listingName(cardName: string, listing: CatalogListing): string {
  const details = listingDetails(listing);
  return details ? `${cardName} — ${details}` : cardName;
}

// ---- Structured data ----------------------------------------------------------

/**
 * The condition every listing is described with to Google — on the card page
 * (itemCondition) and in the product feed (condition). Google's "new" means
 * "in its original packaging, and has not been opened"; a single taken out of
 * a pack, or bought from someone's collection, isn't that, whatever its grade.
 * The grade itself (Near Mint…) is in each listing's name. Changing this one
 * value changes both places.
 */
export const LISTING_CONDITION: "new" | "used" = "used";

const ITEM_CONDITION_URL = {
  new: "https://schema.org/NewCondition",
  used: "https://schema.org/UsedCondition",
} as const;

const BRAND = { "@type": "Brand", name: "Magic: The Gathering" };

/** The listing's picture at Scryfall's "large" size where possible. */
function listingImageUrl(listing: CatalogListing): string | null {
  return storefrontImageUrl(listing.imageUrl ?? null);
}

type SellableListing = CatalogListing & { id: string; priceCents: number };

/** A listing a shopper can buy: it has an id to add to the cart and a real price. */
function isSellable(listing: CatalogListing): listing is SellableListing {
  return (
    typeof listing.id === "string" &&
    listing.id !== "" &&
    typeof listing.priceCents === "number" &&
    Number.isInteger(listing.priceCents) &&
    listing.priceCents > 0
  );
}

function offerFor(slug: string, listing: SellableListing, origin: string): object {
  return {
    "@type": "Offer",
    url: absoluteUrl(listingPagePath(slug, listing.id), origin),
    // A number, as Google asks: 41 for $41.00, 4.5 for $4.50.
    price: Number((listing.priceCents / 100).toFixed(2)),
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    itemCondition: ITEM_CONDITION_URL[LISTING_CONDITION],
  };
}

/**
 * The card as something for sale, one Offer per listing — the shape Google's
 * merchant listings read (an AggregateOffer, a price range, isn't eligible):
 *   * one listing:  a Product with its Offer;
 *   * several:      a ProductGroup whose variants are the listings, each a
 *                   Product with its own SKU, picture and Offer, at its own
 *                   ?listing= address.
 * https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
 * https://developers.google.com/search/docs/appearance/structured-data/product-variants
 * Null when nothing is for sale (a sold-out card's page isn't indexed).
 */
function productJsonLd(slug: string, detail: CatalogCardDetail, origin: string): object | null {
  const sellable = detail.listings.filter(isSellable);
  if (sellable.length === 0) return null;
  const description = detail.typeLine || "Magic: The Gathering trading card";

  if (sellable.length === 1) {
    const listing = sellable[0];
    const image = listingImageUrl(listing);
    return {
      "@context": "https://schema.org",
      "@type": "Product",
      name: detail.cardName,
      description,
      ...(image ? { image: [image] } : {}),
      sku: listing.id,
      category: "Trading Card",
      brand: BRAND,
      offers: offerFor(slug, listing, origin),
    };
  }

  return {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    name: detail.cardName,
    description,
    url: absoluteUrl(cardPagePath(slug), origin),
    productGroupID: detail.oracleId || slug,
    brand: BRAND,
    hasVariant: sellable.map((listing) => {
      const image = listingImageUrl(listing);
      return {
        "@type": "Product",
        name: listingName(detail.cardName, listing),
        ...(image ? { image: [image] } : {}),
        sku: listing.id,
        offers: offerFor(slug, listing, origin),
      };
    }),
  };
}

// ---- The tags ------------------------------------------------------------------

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
 *
 * The same tags serve every ?listing= address of the card: they describe the
 * whole card, and the canonical address is the card's own page.
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
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Shop", item: absoluteUrl("/shop", origin) },
      { "@type": "ListItem", position: 2, name: detail.cardName, item: url },
    ],
  };
  const product = productJsonLd(slug, detail, origin);

  return {
    title: `${detail.cardName} — Buy Magic: The Gathering Singles | Geega Games`,
    description: cardDescription(detail),
    path,
    noIndex: !inStock,
    image: cardImage(detail),
    jsonLd: product ? [breadcrumbs, product] : [breadcrumbs],
  };
}

/**
 * A set page with fewer in-stock listings than this asks not to be indexed,
 * and the sitemap leaves it out (api/sitemap.ts): with one card on it, it
 * only repeats that card's own page. It's still there for shoppers browsing
 * /shop/sets, and indexable again as soon as a second listing arrives.
 */
export const MIN_INDEXABLE_SET_LISTINGS = 2;

/** Whether a set with `listingCount` in-stock listings has a page worth indexing. Unknown counts are given the benefit of the doubt. */
export function isIndexableSet(listingCount: number | null | undefined): boolean {
  return typeof listingCount !== "number" || listingCount >= MIN_INDEXABLE_SET_LISTINGS;
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
    noIndex: !isIndexableSet(set.card_count),
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
