// IndexNow: tells Bing (which also feeds ChatGPT search, Copilot, Yahoo and
// DuckDuckGo), Yandex, Naver and Seznam that a URL changed, so it's crawled in
// hours instead of weeks. Google does not use IndexNow — it reads the sitemap
// (submit it in Search Console). https://www.indexnow.org/documentation
//
// The key isn't a secret: IndexNow proves you own the site by fetching
// https://geega-games.com/<key>.txt, which must contain the key. That file
// lives in public/. Pure module — shared by api/indexnow.ts and tests.

import type { SeoRoute } from "./routes.js";

export const INDEXNOW_KEY = "17dc499ec9e20bbd55743cca8c2e2119";
export const INDEXNOW_HOST = "geega-games.com";
export const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** IndexNow accepts up to 10,000 URLs per request. */
export const INDEXNOW_MAX_URLS = 10_000;

/** Days back to look for changes. The job runs daily; a wider window survives a missed run. */
export const INDEXNOW_LOOKBACK_DAYS = 3;

/**
 * Pages whose lastmod falls within the lookback window, as of `now`. lastmod
 * is a calendar date (YYYY-MM-DD), compared by day in UTC.
 */
export function recentlyChangedPaths(
  routes: SeoRoute[],
  now: Date = new Date(),
  days: number = INDEXNOW_LOOKBACK_DAYS,
): string[] {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return routes.filter((r) => r.lastmod && r.lastmod >= cutoff).map((r) => r.path);
}

export function indexNowPayload(urls: string[]): {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
} {
  return {
    host: INDEXNOW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList: [...new Set(urls)].slice(0, INDEXNOW_MAX_URLS),
  };
}
