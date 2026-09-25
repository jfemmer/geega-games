// Registry of the storefront's indexable, non-data-driven pages.
//
// Every route here is:
//   1. prerendered to static HTML at build time (scripts/prerender.ts), so
//      crawlers that don't run JavaScript still get the page's own title,
//      canonical URL, structured data and content;
//   2. listed in /sitemap.xml (api/sitemap.ts); and
//   3. rewritten to its prerendered file by vercel.json — tests/seoRoutes.test.ts
//      fails if a route here has no matching rewrite.
//
// Data-driven pages (/shop/card/:slug, /shop/set/:code) aren't here: they're
// served by the SPA shell and listed in the sitemap from the database.

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

const STATIC_ROUTES: SeoRoute[] = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/shop", changefreq: "daily", priority: "0.9" },
  { path: "/shop/sets", changefreq: "weekly", priority: "0.7" },
  { path: "/sell-my-collection", changefreq: "weekly", priority: "0.9", lastmod: "2026-09-25" },
  { path: ST_LOUIS_PATH, changefreq: "monthly", priority: "0.9", lastmod: "2026-09-25" },
  { path: "/sell", changefreq: "monthly", priority: "0.7" },
  { path: "/guides", changefreq: "monthly", priority: "0.6", lastmod: "2026-09-25" },
  { path: "/condition-guide", changefreq: "monthly", priority: "0.4" },
  { path: "/shipping", changefreq: "monthly", priority: "0.4" },
  { path: "/returns", changefreq: "monthly", priority: "0.3" },
  { path: "/contact", changefreq: "monthly", priority: "0.3" },
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
      lastmod: "2026-09-25",
    })),
    ...REFERRAL_PAGES.map((page) => ({
      path: page.path,
      changefreq: "monthly" as const,
      priority: "0.7",
      lastmod: "2026-09-25",
    })),
    ...GUIDES.map((guide) => ({
      path: guidePath(guide.slug),
      changefreq: "monthly" as const,
      priority: "0.6",
      lastmod: guide.updated,
    })),
  ];
}
