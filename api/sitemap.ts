import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { slugifyCardName } from "../src/store/lib/cardSlug.js";
import { seoRoutes } from "../src/seo/routes.js";
import { PRODUCTION_ORIGIN } from "../src/seo/site.js";

// GET /sitemap.xml — rewritten here from the site root by vercel.json, which
// must route this path to this function BEFORE its catch-all SPA rewrite.
//
// Every prerendered content page (src/seo/routes.ts — the same registry the
// build-time prerender and vercel.json rewrites use, so they can't drift)
// plus one URL per distinct card currently in stock, so individual Magic:
// The Gathering singles are discoverable/indexable instead of living only
// behind the /shop browse grid. See src/store/pages/CardDetailPage.tsx for
// the page these URLs resolve to, and public.get_card_detail for the RPC
// that page calls — the slug here must match that RPC's own slugify logic.
//
// Falls back to the static-only list on any DB error rather than failing
// the request: an incomplete sitemap is far less harmful to crawlability
// than an unreachable one.

const SITE_URL = PRODUCTION_ORIGIN;
const MAX_CARD_URLS = 5000;

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function urlEntry(loc: string, changefreq: string, priority: string, lastmod?: string): string {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).send("Method not allowed");
    return;
  }

  const entries = seoRoutes().map((p) => urlEntry(`${SITE_URL}${p.path}`, p.changefreq, p.priority, p.lastmod));

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("inventory_items")
      .select("card_name, oracle_id, created_at")
      .eq("status", "active")
      .gt("quantity", 0)
      .order("created_at", { ascending: false })
      .limit(MAX_CARD_URLS);

    if (error) throw error;

    const seen = new Set<string>();
    for (const row of data ?? []) {
      const cardName = row.card_name;
      if (!cardName) continue;
      const dedupeKey = row.oracle_id ?? cardName;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const slug = slugifyCardName(cardName);
      if (!slug) continue;
      entries.push(urlEntry(`${SITE_URL}/shop/card/${slug}`, "weekly", "0.6"));
    }
  } catch (err) {
    console.error("[/sitemap.xml] DB lookup failed, serving static pages only:", err);
  }

  // Set pages: only ones with real depth (2+ cards) are worth asking Google
  // to crawl on their own — a single-card set page is still reachable from
  // /shop/sets for a real visitor, just not submitted as a dedicated URL.
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("shop_sets_with_counts");
    if (error) throw error;
    for (const row of (data ?? []) as { set_code: string; card_count: number }[]) {
      if (row.card_count < 2) continue;
      entries.push(urlEntry(`${SITE_URL}/shop/set/${row.set_code.toLowerCase()}`, "weekly", "0.5"));
    }
  } catch (err) {
    console.error("[/sitemap.xml] set lookup failed, omitting set pages:", err);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(xml);
}
