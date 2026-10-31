import { STORE_TIME_ZONE } from "./tradeDeadlines";

// The storefront logo, with seasonal versions swapped in automatically.
//
// The month is read in store time (St. Louis), so every visitor sees the
// switch at the same moment: midnight on Oct 1 and Nov 1 in St. Louis.
//
// Only the on-site logo changes (header, footer, kiosk, yard sale). Emails,
// the business markup Google reads, printed flyers and the admin dashboard
// keep /logo.png: an email opened in November, or a flyer printed in
// October and handed out all year, should not carry a Halloween logo.
//
// Prerendered pages are built with whichever logo was current at build
// time; the browser re-renders them on load (createRoot, see
// src/prerender.tsx), so a page built in September still shows the October
// logo once the app starts.

export const STANDARD_LOGO = "/logo.png";

/** Month number (1–12) → logo. Add a month here to give it its own logo. */
const SEASONAL_LOGOS: Readonly<Partial<Record<number, string>>> = {
  10: "/logo-october.png",
};

/** The calendar month (1–12) in St. Louis at `now`. */
export function storeMonth(now: Date): number {
  const month = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TIME_ZONE, month: "numeric" }).format(now);
  return Number(month);
}

/** The logo to show at `now`: the month's seasonal logo, or the standard one. */
export function siteLogoSrc(now: Date = new Date()): string {
  return SEASONAL_LOGOS[storeMonth(now)] ?? STANDARD_LOGO;
}

/** Every logo file the storefront can show, for tests and asset checks. */
export const ALL_SITE_LOGOS: readonly string[] = [STANDARD_LOGO, ...Object.values(SEASONAL_LOGOS).filter((src): src is string => Boolean(src))];
