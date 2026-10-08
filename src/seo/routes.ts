// Registry of the storefront's indexable, non-data-driven pages.
//
// Every route here is:
//   1. prerendered to static HTML at build time (scripts/prerender.ts), so
//      crawlers that don't run JavaScript still get the page's own title,
//      canonical URL, structured data and content;
//   2. listed in /sitemap.xml (api/sitemap.ts); and
//   3. rewritten to its prerendered file by vercel.json — the build
//      (scripts/vercelRoutes.ts) and tests/vercelRouting.test.ts fail if a
//      route here has no matching rewrite.
//
// Data-driven pages (/shop/card/:slug, /shop/set/:code) aren't here: their
// HTML is filled in per request by api/catalog-page.ts, and they're listed in
// the sitemap from the database. src/seo/appRoutes.ts covers them and the
// app-only pages (login, account, checkout…).

import { GUIDES, guidePath } from "./guides.js";
import { REFERRAL_PAGES } from "./referralPages.js";
import { SELL_AREAS, ST_LOUIS_PATH, sellAreaPath } from "./sellAreas.js";

export type ChangeFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface SeoRoute {
  path: string;
  changefreq: ChangeFreq;
  priority: string;
  /** ISO date of the last meaningful content change, when known. */
  lastmod?: string;
}

// lastmod: only when the page's own content meaningfully changed (Google uses
// it once it's consistently accurate), and /api/indexnow pings Bing about
// pages whose lastmod is recent — so bump it when you change a page.
const SEO_REFRESH = "2026-09-26";

const STATIC_ROUTES: SeoRoute[] = [
  // 2026-10-05: the email-list signup replaced the launch notice.
  { path: "/", changefreq: "daily", priority: "1.0", lastmod: "2026-10-05" },
  { path: "/shop", changefreq: "daily", priority: "0.9" },
  { path: "/shop/sets", changefreq: "weekly", priority: "0.7" },
  { path: "/sell-my-collection", changefreq: "weekly", priority: "0.9", lastmod: SEO_REFRESH },
  { path: ST_LOUIS_PATH, changefreq: "monthly", priority: "0.9", lastmod: SEO_REFRESH },
  { path: "/sell", changefreq: "monthly", priority: "0.7" },
  { path: "/guides", changefreq: "monthly", priority: "0.6", lastmod: SEO_REFRESH },
  { path: "/about", changefreq: "monthly", priority: "0.5", lastmod: SEO_REFRESH },
  { path: "/condition-guide", changefreq: "monthly", priority: "0.4", lastmod: "2026-09-26" },
  // 2026-10-05: "Where we ship" (the United States only).
  { path: "/shipping", changefreq: "monthly", priority: "0.4", lastmod: "2026-10-05" },
  { path: "/returns", changefreq: "monthly", priority: "0.3", lastmod: "2026-09-26" },
  { path: "/contact", changefreq: "monthly", priority: "0.3", lastmod: "2026-09-26" },
  { path: "/privacy", changefreq: "yearly", priority: "0.1" },
  { path: "/terms", changefreq: "yearly", priority: "0.1" },
];

export function seoRoutes(): SeoRoute[] {
  return [
    ...STATIC_ROUTES,
    ...SELL_AREAS.map((area) => ({
      path: sellAreaPath(area.slug),
      changefreq: "monthly" as const,
      priority: "0.7",
      lastmod: SEO_REFRESH,
    })),
    ...REFERRAL_PAGES.map((page) => ({
      path: page.path,
      changefreq: "monthly" as const,
      priority: "0.8",
      lastmod: SEO_REFRESH,
    })),
    ...GUIDES.map((guide) => ({
      path: guidePath(guide.slug),
      changefreq: "monthly" as const,
      priority: "0.6",
      lastmod: guide.updated,
    })),
  ];
}
