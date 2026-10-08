import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import {
  SITE_URL,
  catalogEntries,
  urlEntry,
  type SitemapInventoryRow,
  type SitemapSetRow,
} from "./_lib/sitemapCatalog.js";
import { seoRoutes } from "../src/seo/routes.js";

// GET /sitemap.xml — rewritten here from the site root by vercel.json.
//
// Every prerendered content page (src/seo/routes.ts — the same registry the
// build-time prerender and vercel.json rewrites use, so they can't drift)
// plus one URL per distinct card currently in stock, so individual Magic:
// The Gathering singles are discoverable/indexable instead of living only
// behind the /shop browse grid. See src/store/pages/CardDetailPage.tsx for
// the page these URLs resolve to (api/catalog-page.ts serves its HTML), and
// public.get_card_detail for the RPC both call — the slug here must match
// that RPC's own slugify logic.
//
// Card and set pages carry <lastmod>: when one of their listings last
// changed (added, repriced, sold down — inventory_items.updated_at). Bing
// calls lastmod a key signal and asks that it be the page's real
// modification time, and Google uses it once it's consistently accurate, so
// it is never "now":
//   https://blogs.bing.com/webmaster/2025/7/Keeping-Content-Discoverable-with-Sitemaps-in-AI-Powered-Search
//   https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
//
// Falls back to the static-only list on any DB error rather than failing
// the request: an incomplete sitemap is far less harmful to crawlability
// than an unreachable one.

const MAX_INVENTORY_ROWS = 10000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).send("Method not allowed");
    return;
  }

  const entries = seoRoutes().map((p) => urlEntry(`${SITE_URL}${p.path}`, p.changefreq, p.priority, p.lastmod));

  let rows: SitemapInventoryRow[] = [];
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("inventory_items")
      .select("card_name, oracle_id, set_code, quantity, updated_at")
      .eq("status", "active")
      .not("oracle_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_INVENTORY_ROWS);
    if (error) throw error;
    rows = (data ?? []) as SitemapInventoryRow[];
  } catch (err) {
    console.error("[/sitemap.xml] DB lookup failed, serving static pages only:", err);
  }

  let sets: SitemapSetRow[] | null = null;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("shop_sets_with_counts");
    if (error) throw error;
    sets = (data ?? []) as SitemapSetRow[];
  } catch (err) {
    console.error("[/sitemap.xml] set lookup failed, omitting set pages:", err);
  }

  entries.push(...catalogEntries(rows, sets));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(xml);
}
