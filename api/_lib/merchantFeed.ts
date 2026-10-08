import {
  LISTING_CONDITION,
  conditionName,
  finishName,
  listingDetails,
  listingPagePath,
} from "../../src/seo/catalog.js";
import { PRODUCTION_ORIGIN, absoluteUrl } from "../../src/seo/site.js";
import { storefrontImageUrl } from "../../src/store/lib/cardImages.js";
import { slugifyCardName } from "../../src/store/lib/cardSlug.js";

// The product feed (/feeds/products.xml, served by api/merchant-feed.ts):
// every copy for sale, one <item> each, in the format Google Merchant Center
// reads — RSS 2.0 with Google's "g:" attributes. Microsoft Merchant Center
// reads the same file. With a feed, the shop's cards can appear in the free
// product listings of Google Search and Shopping and of the Bing Shopping
// tab, which the owner turns on in each Merchant Center account
// (docs/SEO.md, "Product feed").
//
//   https://support.google.com/merchants/answer/7052112  (product data specification)
//   https://support.google.com/merchants/answer/160589   (RSS 2.0 feed)
//   https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_conc_aboutbingmerchantcentercatalogfile
//
// Pure functions of the listings, so the file can be checked without a
// database; the handler does the fetching.

/** One copy for sale: a row of public.search_inventory (the same listings the shop grid shows). */
export interface FeedListing {
  id: string;
  oracleId: string | null;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  rarity: string | null;
  typeLine: string | null;
  imageUrl: string | null;
  condition: string;
  finish: string;
  variantType: string | null;
  /** Copies that can be bought now (held copies excluded). */
  quantity: number;
  /** What it sells for now (deals included), in cents. */
  priceCents: number;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;

/**
 * The rows of public.search_inventory a feed can list: in stock, with an id,
 * a name and a real price. Anything else is left out rather than sent to
 * Google half-described (an item with a price of 0 is disapproved).
 */
export function toFeedListings(rows: unknown): FeedListing[] {
  const listings: FeedListing[] = [];
  for (const item of Array.isArray(rows) ? rows : []) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const cardName = text(row.card_name);
    const quantity = whole(row.quantity);
    const priceCents = whole(row.price_cents);
    if (!id || !cardName || !quantity || quantity <= 0 || !priceCents || priceCents <= 0) continue;
    listings.push({
      id,
      oracleId: text(row.oracle_id),
      cardName,
      setCode: text(row.set_code),
      setName: text(row.set_name),
      collectorNumber: text(row.collector_number),
      rarity: text(row.rarity),
      typeLine: text(row.type_line),
      imageUrl: text(row.image_url),
      condition: text(row.condition) ?? "NM",
      finish: text(row.finish) ?? "nonfoil",
      variantType: text(row.variant_type),
      quantity,
      priceCents,
    });
  }
  return listings;
}

/** Google's and Microsoft's limits on a title. */
export const MAX_TITLE_LENGTH = 150;

/** Shortened at a word to fit `max` characters, if it has to be. */
function fit(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,—-]+$/, "")}…`;
}

/**
 * "Orcish Bowmasters — Magic: The Gathering — The Lord of the Rings: Tales of
 * Middle-earth #433, Lightly Played, Foil, Borderless". The card and the game
 * first, as shoppers search for them; then what tells this copy from the
 * card's other listings (Google asks variants to say so in the title).
 */
export function feedTitle(listing: FeedListing): string {
  const details = listingDetails(listing);
  return fit(
    details ? `${listing.cardName} — Magic: The Gathering — ${details}` : `${listing.cardName} — Magic: The Gathering`,
    MAX_TITLE_LENGTH,
  );
}

/** Plain text about the card itself: no links, prices or shop talk, as Google asks. */
export function feedDescription(listing: FeedListing): string {
  const printing = [
    listing.setName ?? listing.setCode?.toUpperCase() ?? null,
    listing.collectorNumber ? `#${listing.collectorNumber}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const sentences = [
    `${listing.cardName}, a single Magic: The Gathering card${listing.typeLine ? ` (${listing.typeLine})` : ""}.`,
    printing ? `Printing: ${printing}${listing.rarity ? `, ${listing.rarity}` : ""}.` : null,
    listing.variantType ? `Version: ${listing.variantType}.` : null,
    `Condition: ${conditionName(listing.condition)}.`,
    `Finish: ${finishName(listing.finish) ?? "Nonfoil"}.`,
  ];
  return sentences.filter(Boolean).join(" ");
}

/** Characters XML 1.0 doesn't allow at all; a stray one would make the whole file unreadable. */
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function xml(value: string): string {
  return value
    .replace(NOT_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tag(name: string, value: string): string {
  return `      <g:${name}>${xml(value)}</g:${name}>`;
}

/** "41.00 USD" */
function price(cents: number): string {
  return `${(cents / 100).toFixed(2)} USD`;
}

/** What a feed looks like to the person reading it, for a header or a log line. */
export interface FeedSummary {
  items: number;
  /** Listed copies left out because they have no picture (Google requires one). */
  withoutImage: number;
}

/**
 * The feed. Every file lists every copy for sale: a copy missing from it is
 * removed from Merchant Center, which is how a sold copy leaves.
 *
 *   * id           the listing's id, which is also its SKU on the card page
 *   * link         the card page with this copy chosen (?listing=), the same
 *                  address the page's structured data gives the copy; no
 *                  tracking parameters (Microsoft's free listings refuse them)
 *   * availability "in stock": only copies for sale are listed. Written with
 *                  a space, which Google accepts and Microsoft documents
 *   * condition    LISTING_CONDITION (src/seo/catalog.ts), as on the page
 *   * identifier_exists  "no": singles have no barcode (GTIN) or part number
 *   * item_group_id      a card with several copies for sale on one page is
 *                  one product with variants (Google: "use the same group ID
 *                  for every version a customer can select on one landing
 *                  page"); the same id the page's ProductGroup uses
 *
 * Shipping and tax aren't in the file: they're set once in each Merchant
 * Center account, which Google prefers to per-item values.
 */
export function buildMerchantFeed(
  listings: FeedListing[],
  origin: string = PRODUCTION_ORIGIN,
): { xml: string; summary: FeedSummary } {
  const copiesPerCard = new Map<string, number>();
  for (const listing of listings) {
    if (listing.oracleId) copiesPerCard.set(listing.oracleId, (copiesPerCard.get(listing.oracleId) ?? 0) + 1);
  }

  const items: string[] = [];
  const seen = new Set<string>();
  let withoutImage = 0;
  for (const listing of listings) {
    if (seen.has(listing.id)) continue;
    seen.add(listing.id);
    const slug = slugifyCardName(listing.cardName);
    if (!slug) continue;
    const image = storefrontImageUrl(listing.imageUrl);
    if (!image) {
      withoutImage += 1;
      continue;
    }
    const grouped = listing.oracleId !== null && (copiesPerCard.get(listing.oracleId) ?? 0) > 1;
    items.push(
      [
        "    <item>",
        tag("id", listing.id),
        tag("title", feedTitle(listing)),
        tag("description", feedDescription(listing)),
        tag("link", absoluteUrl(listingPagePath(slug, listing.id), origin)),
        tag("image_link", image),
        tag("availability", "in stock"),
        tag("price", price(listing.priceCents)),
        tag("condition", LISTING_CONDITION),
        tag("brand", "Magic: The Gathering"),
        tag("identifier_exists", "no"),
        grouped ? tag("item_group_id", listing.oracleId as string) : "",
        grouped ? tag("item_group_title", fit(listing.cardName, MAX_TITLE_LENGTH)) : "",
        tag("product_type", "Trading Cards > Magic: The Gathering > Singles"),
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const home = absoluteUrl("/", origin);
  const xmlText = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    "    <title>Geega Games</title>",
    `    <link>${xml(home)}</link>`,
    "    <description>Magic: The Gathering singles for sale at Geega Games</description>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
  return { xml: xmlText, summary: { items: items.length, withoutImage } };
}
