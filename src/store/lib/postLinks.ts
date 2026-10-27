import { PRODUCTION_ORIGIN } from "../../seo/site";
import { slugifyCardName } from "./cardSlug";

// Links for social posts that land on the cards in the post, not on the
// whole shop: one card links to its own page, several to the picks page
// (/shop/picks?c=slug,slug,…) that shows exactly those cards. Each link is
// tagged (utm_source / utm_medium / utm_campaign) so the admin Overview's
// "Visits from your posts" can tell which posts brought people in.

export const PICKS_PATH = "/shop/picks";
/** The most cards one picks link shows. */
export const MAX_PICKS = 24;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The card slugs in a picks link's ?c=, cleaned, de-duplicated and capped. */
export function readPickSlugs(param: string | null): string[] {
  if (!param) return [];
  const slugs: string[] = [];
  for (const raw of param.split(",")) {
    const slug = raw.trim().toLowerCase();
    if (slug.length <= 150 && SLUG_RE.test(slug) && !slugs.includes(slug)) slugs.push(slug);
    if (slugs.length >= MAX_PICKS) break;
  }
  return slugs;
}

/** "2026-10-27" in St. Louis for a campaign name. */
function storeDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The link to paste into a Facebook post for these cards, or null for none:
 * a card page for one card, the picks page for several (the first
 * MAX_PICKS different cards).
 */
export function facebookPostLink(cardNames: string[], now: Date = new Date()): string | null {
  const slugs = readPickSlugs(cardNames.map(slugifyCardName).join(","));
  if (slugs.length === 0) return null;
  const tags = new URLSearchParams({ utm_source: "facebook", utm_medium: "social" });
  if (slugs.length === 1) {
    tags.set("utm_campaign", slugs[0]);
    return `${PRODUCTION_ORIGIN}/shop/card/${slugs[0]}?${tags.toString()}`;
  }
  tags.set("utm_campaign", `picks-${storeDay(now)}`);
  return `${PRODUCTION_ORIGIN}${PICKS_PATH}?c=${slugs.join(",")}&${tags.toString()}`;
}
