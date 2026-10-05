import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowCronRequest } from "./_lib/cronAuth.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { seoRoutes } from "../src/seo/routes.js";
import { PRODUCTION_ORIGIN } from "../src/seo/site.js";
import { slugifyCardName } from "../src/store/lib/cardSlug.js";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_LOOKBACK_DAYS,
  indexNowPayload,
  recentlyChangedPaths,
} from "../src/seo/indexnow.js";

// GET /api/indexnow — daily Vercel cron (see "crons" in vercel.json).
//
// Tells IndexNow (Bing — and through it ChatGPT search and Copilot — plus
// Yandex, Naver and Seznam) about pages that changed in the last few days:
//   * content pages whose lastmod in src/seo/routes.ts is recent, and
//   * card pages for singles listed in the last few days.
// Google doesn't use IndexNow; it reads /sitemap.xml.
//
// Only Vercel's scheduler can trigger it, and only on the production
// deployment (see allowCronRequest in _lib/cronAuth.ts).

const REQUEST_TIMEOUT_MS = 10_000;

async function recentCardPaths(since: Date): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("inventory_items")
    .select("card_name, oracle_id")
    .eq("status", "active")
    .gt("quantity", 0)
    // Only cards that have a page (see the same filter in api/sitemap.ts).
    .not("oracle_id", "is", null)
    .gte("created_at", since.toISOString())
    .limit(5000);
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const row of data ?? []) {
    if (!row.card_name) continue;
    const key = row.oracle_id ?? row.card_name;
    if (seen.has(key)) continue;
    seen.add(key);
    const slug = slugifyCardName(row.card_name);
    if (slug) paths.push(`/shop/card/${slug}`);
  }
  return paths;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowCronRequest(req, res)) return;

  const now = new Date();
  const since = new Date(now.getTime() - INDEXNOW_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const paths = recentlyChangedPaths(seoRoutes(), now);
  try {
    paths.push(...(await recentCardPaths(since)));
  } catch (err) {
    // Content pages still go out; card pages wait for tomorrow's run.
    console.error("[/api/indexnow] card lookup failed:", err);
  }

  const payload = indexNowPayload(paths.map((p) => `${PRODUCTION_ORIGIN}${p}`));
  if (payload.urlList.length === 0) {
    return res.status(200).json({ ok: true, submitted: 0 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // 200 OK and 202 Accepted both mean the submission was received.
    if (response.status !== 200 && response.status !== 202) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      console.error("[/api/indexnow] rejected:", response.status, detail);
      return res.status(502).json({ ok: false, status: response.status, submitted: 0 });
    }
    console.log(`[/api/indexnow] submitted ${payload.urlList.length} URL(s)`);
    return res.status(200).json({ ok: true, status: response.status, submitted: payload.urlList.length });
  } catch (err) {
    console.error("[/api/indexnow] request failed:", err);
    return res.status(502).json({ ok: false, message: "IndexNow request failed." });
  } finally {
    clearTimeout(timer);
  }
}
