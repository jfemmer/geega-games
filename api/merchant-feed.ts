import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabasePublic } from "./_lib/supabasePublic.js";
import { buildMerchantFeed, toFeedListings, type FeedListing } from "./_lib/merchantFeed.js";

// GET /feeds/products.xml — rewritten here by vercel.json.
//
// The product feed for Google Merchant Center and Microsoft Merchant Center
// (see api/_lib/merchantFeed.ts for what is in it, and docs/SEO.md for the
// account setup only the owner can do). Each Merchant Center fetches this
// address on a schedule — at most once a day — so it is built fresh from the
// inventory on each fetch, with a short edge cache.
//
//   * It reads through the publishable key, like a signed-out visitor's
//     browser, using the same function as the shop grid
//     (public.search_inventory, in stock only): it can only list what the
//     shop itself shows, at the price checkout charges.
//   * If the inventory can't be read completely, it answers 503 rather than
//     a short or empty feed. Merchant Center removes every product that is
//     missing from a fetched file, so a partial answer would take listings
//     down; a failed fetch is simply retried and changes nothing.
//   * It asks not to be indexed (X-Robots-Tag): it's for Merchant Center,
//     not for search results.

const PAGE_SIZE = 100; // search_inventory returns at most 100 rows per call
const MAX_PAGES = 100; // 10,000 copies: far more than the shop stocks
const LOOKUP_TIMEOUT_MS = 5000;
const FEED_CACHE = "public, max-age=0, s-maxage=900, stale-while-revalidate=3600";

/** Every copy for sale, a hundred at a time, in a stable order (name, then id). */
async function loadListings(): Promise<FeedListing[]> {
  const db = getSupabasePublic();
  const listings: FeedListing[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db
      .rpc("search_inventory", {
        p_in_stock_only: true,
        p_sort: "name_asc",
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      })
      .abortSignal(AbortSignal.timeout(LOOKUP_TIMEOUT_MS));
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    listings.push(...toFeedListings(rows));
    if (rows.length < PAGE_SIZE) return listings;
  }
  throw new Error(`more than ${MAX_PAGES * PAGE_SIZE} listings; raise MAX_PAGES`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }
  res.setHeader("X-Robots-Tag", "noindex");

  let listings: FeedListing[];
  try {
    listings = await loadListings();
  } catch (err) {
    console.error("[merchant-feed] inventory unavailable, answering 503:", err);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "600");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(503).send("The product feed is temporarily unavailable. Please try again shortly.");
  }

  const { xml, summary } = buildMerchantFeed(listings);
  if (summary.withoutImage > 0) {
    console.warn(`[merchant-feed] ${summary.withoutImage} listing(s) left out: no picture`);
  }
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", FEED_CACHE);
  // How many products the file lists, for checking a live deployment.
  res.setHeader("X-GG-Feed-Items", String(summary.items));
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(xml);
}
