// Store policies (owner-approved 2026-09-26): 14-day window to report a
// problem; Geega pays return shipping when a card's condition was listed
// wrong; orders ship within 2 business days (Mon–Sat — no Sunday post);
// email replies within 24 hours; photos of the actual card on request for
// cards $5 and up (2026-09-27; see PHOTO_REQUEST_MIN_PRICE_CENTS).
// Change these constants, not the page copy, if a policy changes.
//
// Pure module: the policy pages (src/store/pages/StaticPages.tsx) show these,
// and the site's structured data (src/seo/site.ts) states the same handling
// time to search engines, so the two can't disagree.

export const RETURN_WINDOW_DAYS = 14;
export const SHIPS_WITHIN_BUSINESS_DAYS = 2;
export const REPLY_WITHIN_HOURS = 24;

/** The days orders go out. The post office is closed on Sundays. */
export const SHIPPING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
