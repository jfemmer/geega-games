import { STORE_TIME_ZONE } from "./tradeDeadlines";

// The storefront logo, with seasonal versions swapped in automatically.
//
// Dates are read in store time (St. Louis), so every visitor sees each
// switch at the same moment: midnight in St. Louis at the start of a
// season's first day and at the end of its last day.
//
// Only the on-site logo changes (header, footer, kiosk, yard sale). Emails,
// the business markup Google reads, printed flyers and the admin dashboard
// keep /logo.png: an email opened in November, or a flyer printed in
// October and handed out all year, should not carry a holiday logo.
//
// Prerendered pages are built with whichever logo was current at build
// time; the browser re-renders them on load (createRoot, see
// src/prerender.tsx), so a page built before a season starts still shows
// the season's logo once the app starts.

export const STANDARD_LOGO = "/logo.png";

/**
 * A logo shown every year from one calendar day to another, both days
 * included. Seasons must not overlap or cross New Year's.
 */
interface LogoSeason {
  name: string;
  src: string;
  month: number; // 1–12
  firstDay: number;
  lastDay: number;
}

/** Add a season here to give it its own logo. */
const SEASONAL_LOGOS: readonly LogoSeason[] = [
  { name: "Halloween", src: "/logo-october.png", month: 10, firstDay: 1, lastDay: 31 },
  { name: "Christmas", src: "/logo-christmas.png", month: 12, firstDay: 1, lastDay: 25 },
];

const storeDateFormat = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TIME_ZONE, month: "numeric", day: "numeric" });

/** The calendar month (1–12) and day in St. Louis at `now`. */
export function storeDate(now: Date): { month: number; day: number } {
  let month = 0;
  let day = 0;
  for (const part of storeDateFormat.formatToParts(now)) {
    if (part.type === "month") month = Number(part.value);
    if (part.type === "day") day = Number(part.value);
  }
  return { month, day };
}

/** The calendar month (1–12) in St. Louis at `now`. */
export function storeMonth(now: Date): number {
  return storeDate(now).month;
}

/** The logo to show at `now`: the current season's logo, or the standard one. */
export function siteLogoSrc(now: Date = new Date()): string {
  const { month, day } = storeDate(now);
  const season = SEASONAL_LOGOS.find((s) => s.month === month && day >= s.firstDay && day <= s.lastDay);
  return season?.src ?? STANDARD_LOGO;
}

/** Every logo file the storefront can show, for tests and asset checks. */
export const ALL_SITE_LOGOS: readonly string[] = [STANDARD_LOGO, ...SEASONAL_LOGOS.map((s) => s.src)];
