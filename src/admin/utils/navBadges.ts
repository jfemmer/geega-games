// Number badges in the admin: which count goes on which part of the sidebar,
// and the total shown on the phone menu button and the installed app's icon.
// The counts come from the admin_nav_badges() database function (see its
// migration). Shared by the admin app and api/_lib/staffPush.ts, so keep this
// module pure: no browser or Node APIs, no imports.

export interface NavBadgeCounts {
  /** Paid orders waiting to be packed. */
  needs_packing: number;
  /** Card photo requests nobody has answered yet. */
  open_photo_requests: number;
  /** Pickup requests waiting to be pulled. */
  waiting_pickups: number;
  /** Buying leads nobody has reviewed yet. */
  new_leads: number;
  /** Partner leads nobody has handled yet. */
  new_partner_leads: number;
  /** Sign-ups since this staff member last opened Users. */
  new_users: number;
}

export type NavBadgeKey = keyof NavBadgeCounts;

export const EMPTY_NAV_BADGES: NavBadgeCounts = {
  needs_packing: 0,
  open_photo_requests: 0,
  waiting_pickups: 0,
  new_leads: 0,
  new_partner_leads: 0,
  new_users: 0,
};

const KEYS = Object.keys(EMPTY_NAV_BADGES) as NavBadgeKey[];

/**
 * Sidebar item (NAV_ITEMS key) → its count, and how a screen reader should
 * read the number.
 */
export const NAV_BADGES: Partial<Record<string, { count: NavBadgeKey; describe: (n: number) => string }>> = {
  orders: { count: "needs_packing", describe: (n) => `${n} to pack` },
  inventory: { count: "open_photo_requests", describe: (n) => `${n} photo request${n === 1 ? "" : "s"} waiting` },
  pickup: { count: "waiting_pickups", describe: (n) => `${n} waiting` },
  "buying-leads": { count: "new_leads", describe: (n) => `${n} new` },
  "partner-leads": { count: "new_partner_leads", describe: (n) => `${n} new` },
  users: { count: "new_users", describe: (n) => `${n} new since you last looked` },
};

/** Reads the database function's JSON. Anything missing or odd counts as 0. */
export function parseNavBadges(value: unknown): NavBadgeCounts {
  const out: NavBadgeCounts = { ...EMPTY_NAV_BADGES };
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  for (const key of KEYS) {
    const n = Number(record[key]);
    out[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out;
}

/** Everything waiting: the phone menu button and the app icon show this. */
export function navBadgeTotal(counts: NavBadgeCounts): number {
  return KEYS.reduce((sum, key) => sum + counts[key], 0);
}

/** "99+" past 99, so a badge never outgrows its circle. */
export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Customer sources that count as a sign-up (the new_users count uses the same list). */
const SIGNUP_SOURCES = new Set(["account_signup", "checkout", "newsletter"]);

/**
 * Whether Users should mark a customer "New": they signed up after `since`
 * (the staff member's previous visit). Customers staff added or imported
 * never count.
 */
export function isNewSignup(customer: { createdAt: string; source?: string }, since: string | null): boolean {
  if (!since) return false;
  if (customer.source && !SIGNUP_SOURCES.has(customer.source)) return false;
  const created = Date.parse(customer.createdAt);
  const seen = Date.parse(since);
  return Number.isFinite(created) && Number.isFinite(seen) && created > seen;
}
