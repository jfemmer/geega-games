import { cardPagePath, isIndexableSet, setPagePath } from "../../src/seo/catalog.js";
import { PRODUCTION_ORIGIN } from "../../src/seo/site.js";
import { slugifyCardName } from "../../src/store/lib/cardSlug.js";

// The sitemap's entries for the catalog (card and set pages), worked out from
// the inventory by pure functions so they can be tested without a database.
// api/sitemap.ts does the fetching. See that file for what the sitemap is for.

export const SITE_URL = PRODUCTION_ORIGIN;

export function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function urlEntry(loc: string, changefreq: string, priority: string, lastmod?: string): string {
  return [
    "  <url>",
    `    <loc>${xmlEscape(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : "",
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A row of public.inventory_items, as the sitemap reads it. */
export interface SitemapInventoryRow {
  card_name: string | null;
  oracle_id: string | null;
  set_code: string | null;
  quantity: number | null;
  updated_at: string | null;
}

/** A row of public.shop_sets_with_counts. */
export interface SitemapSetRow {
  set_code: string;
  card_count: number;
}

/**
 * The later of two timestamps, ignoring a missing or unreadable one, written
 * the way sitemaps state times ("2026-10-08T14:32:10Z", W3C Datetime).
 */
function later(a: string | undefined, b: string | null): string | undefined {
  const time = b ? Date.parse(b) : NaN;
  if (Number.isNaN(time)) return a;
  if (a === undefined || time > Date.parse(a)) return new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");
  return a;
}

/**
 * The card and set entries, from the active inventory and the in-stock set
 * counts. Pure, so it can be tested without a database.
 *
 *   * A card is listed when any active copy of it is in stock. Its lastmod
 *     is the latest change to any of its active copies — a copy that just
 *     sold down to zero changed the page too.
 *   * A set is listed when it has enough in-stock listings to be indexed
 *     (src/seo/catalog.ts, the same rule the set page's robots tag uses),
 *     with the latest change to its active copies.
 */
export function catalogEntries(rows: SitemapInventoryRow[], sets: SitemapSetRow[] | null): string[] {
  const cards = new Map<string, { slug: string; inStock: boolean; lastmod?: string }>();
  const setLastmod = new Map<string, string | undefined>();

  for (const row of rows) {
    // A card page is looked up by oracle id (public.get_card_detail); an
    // item without one has no page, and a sitemap must not list a 404.
    if (!row.oracle_id || !row.card_name) continue;
    const slug = slugifyCardName(row.card_name);
    if (!slug) continue;
    const card = cards.get(row.oracle_id) ?? { slug, inStock: false };
    card.inStock ||= (row.quantity ?? 0) > 0;
    card.lastmod = later(card.lastmod, row.updated_at);
    cards.set(row.oracle_id, card);

    const code = row.set_code?.toLowerCase();
    if (code) setLastmod.set(code, later(setLastmod.get(code), row.updated_at));
  }

  const entries: string[] = [];
  for (const card of cards.values()) {
    if (!card.inStock) continue;
    entries.push(urlEntry(`${SITE_URL}${cardPagePath(card.slug)}`, "weekly", "0.6", card.lastmod));
  }

  // Set pages: only ones with real depth are worth asking Google to crawl on
  // their own — a single-card set page is still reachable from /shop/sets for
  // a real visitor, just not submitted (and marked noindex).
  for (const set of sets ?? []) {
    if (!set.set_code || !isIndexableSet(set.card_count)) continue;
    const code = set.set_code.toLowerCase();
    entries.push(urlEntry(`${SITE_URL}${setPagePath(code)}`, "weekly", "0.5", setLastmod.get(code)));
  }
  return entries;
}
