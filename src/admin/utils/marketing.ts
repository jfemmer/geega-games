// The admin Marketing page's data: which public pages a tagged link or QR
// code can point to, the words printed on a flyer or table sign for each one,
// and the "where leads come from" counts.
//
// Pure module (no React, browser or Supabase imports), so it's unit-tested
// directly.
//
// Printed copy follows the seller pages' content rules (src/seo/referralPages.ts):
//   * Geega Games buys Magic: The Gathering only. Anything else goes, with the
//     seller's OK, to one vetted partner store, which makes the offer.
//   * Wherever partner stores come up, say they may pay Geega Games a
//     referral fee and that the seller is never charged.
//   * No payout, price or turnaround promises. A flyer outlives the week it
//     was printed, so nothing that goes stale either: no prices, discounts or
//     dates (except the extra line the owner types for an event).

import { PRODUCTION_ORIGIN } from "../../seo/site";
import { ST_LOUIS_PATH } from "../../seo/sellAreas";
import { REFERRAL_PAGES } from "../../seo/referralPages";
import { FOR_STORES_PATH, REFERRAL_PARTNERS_PATH, SELL_HUB_PATH } from "../../store/lib/partnerTypes";
import {
  UNKNOWN_LEAD_SOURCE,
  cleanCampaignToken,
  cleanRefCode,
  leadSourceBucket,
  taggedLink,
  type LeadSourceFields,
} from "../../store/lib/attribution";

/** What a flyer or table sign says about one page. */
export interface FlyerCopy {
  headline: string;
  /** One sentence under the headline. */
  sub: string;
  /** Three or four short selling points. */
  points: string[];
  /** Under the QR code: "Scan for a free offer". */
  cta: string;
  /** The small print at the bottom, or null when nothing needs saying. */
  finePrint: string | null;
  /** The bold line on each tear-off strip, above the address. */
  stripLabel: string;
}

export interface MarketingPage {
  key: string;
  /** How the page is listed in the Marketing page's "Link to" menu. */
  label: string;
  path: string;
  copy: FlyerCopy;
}

/** For anything that sends a seller to a partner store. Same plain words as the seller pages. */
const PARTNER_FEE_FINE_PRINT =
  "Geega Games buys Magic: The Gathering cards. Other collections go, with your OK, to one vetted partner store, which may pay Geega Games a referral fee. You're never charged.";

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function referralFlyerCopy(noun: string): FlyerCopy {
  return {
    headline: `Selling ${noun}?`,
    sub: `Get a free, no-obligation offer from a vetted partner store that buys ${noun}.`,
    points: [
      "Tell us what you have — a few photos is plenty",
      "No sorting or pricing needed",
      "Every partner store agrees to fair, no-pressure offers",
      "You decide whether to sell",
    ],
    cta: "Scan for a free offer",
    finePrint: `Geega Games doesn't buy ${noun} itself. With your OK, we pass your details to one vetted partner store, which may pay Geega Games a referral fee. You're never charged.`,
    stripLabel: `Selling ${noun}?`,
  };
}

export const MARKETING_PAGES: MarketingPage[] = [
  {
    key: "hub",
    label: "Sell anything: cards & video games (start here)",
    path: SELL_HUB_PATH,
    copy: {
      headline: "Selling a card or video game collection?",
      sub: "Magic: The Gathering, Pokémon and One Piece cards, and video games.",
      points: [
        "Free, no-obligation offers",
        "No sorting or pricing needed — a few photos is plenty",
        "Magic cards: we buy them ourselves",
        "Everything else: a vetted partner store makes the offer",
      ],
      cta: "Scan for a free offer",
      finePrint: PARTNER_FEE_FINE_PRINT,
      stripLabel: "Sell your collection",
    },
  },
  {
    key: "magic",
    label: "Magic: The Gathering — sell your collection",
    path: "/sell-my-collection",
    copy: {
      headline: "Sell your Magic: The Gathering cards",
      sub: "Singles, bulk or a whole collection — sorted or not.",
      points: [
        "Free, no-obligation offer",
        "Send photos or a list — no sorting or pricing needed",
        "Meet up in St. Louis, or ship from anywhere in the US",
        "Big collection? We travel about 6 hours from St. Louis",
      ],
      cta: "Scan for a free offer",
      finePrint: null,
      stripLabel: "Sell your Magic cards",
    },
  },
  {
    key: "st_louis",
    label: "Magic: The Gathering — St. Louis",
    path: ST_LOUIS_PATH,
    copy: {
      headline: "Sell your Magic cards in St. Louis",
      sub: "A local buyer for Magic: The Gathering singles, bulk and whole collections.",
      points: [
        "Free, no-obligation offer",
        "Meet up locally — no shipping needed",
        "Collections of every size, sorted or not",
      ],
      cta: "Scan for a free offer",
      finePrint: null,
      stripLabel: "Sell Magic cards in STL",
    },
  },
  ...REFERRAL_PAGES.map(
    (page): MarketingPage => ({
      key: page.category,
      label: `${capitalize(page.noun)} (partner store)`,
      path: page.path,
      copy: referralFlyerCopy(page.noun),
    }),
  ),
  {
    key: "for_stores",
    label: "For stores — collection leads",
    path: FOR_STORES_PATH,
    copy: {
      headline: "Collection leads for card and video game stores",
      sub: "We send you people selling Pokémon cards, One Piece cards and video games — sellers who asked to hear from a store.",
      points: [
        "No sign-up cost and no monthly fee",
        "A finder's fee only when you buy",
        "Each lead goes to one store",
        "What they have, photos when they add them, and how to reach them",
      ],
      cta: "Scan to apply",
      finePrint:
        "The finder's fee is a percentage of what you pay the seller, agreed before your first lead. Partner stores agree to fair, no-pressure offers.",
      stripLabel: "Leads for stores",
    },
  },
  {
    key: "referral_partners",
    label: "Referral partners — estate sales, attorneys, realtors",
    path: REFERRAL_PARTNERS_PATH,
    copy: {
      headline: "Clients with cards or video games to sell?",
      sub: "Estate sale companies, attorneys, realtors and move managers: send them to Geega Games.",
      points: [
        "Free, no-obligation offers for your clients",
        "A referral fee for you when a collection sells",
        "Your own link and QR code to share",
      ],
      cta: "Scan to become a partner",
      finePrint:
        "The referral fee is a percentage of what your client is paid, agreed with you in writing when you join.",
      stripLabel: "Referral partners",
    },
  },
  {
    key: "home",
    label: "Home page — shop Magic singles",
    path: "/",
    copy: {
      headline: "Buy and sell Magic: The Gathering cards",
      sub: "Magic singles shipped from St. Louis, and a local buyer for your collection.",
      points: [
        "Shop Magic singles online",
        "Sell us your cards: free, no-obligation offers",
        "Based in St. Louis, shipping across the US",
      ],
      cta: "Scan to visit",
      finePrint: null,
      stripLabel: "Geega Games",
    },
  },
];

export const DEFAULT_MARKETING_PAGE = MARKETING_PAGES[0];

export function marketingPage(key: string): MarketingPage {
  return MARKETING_PAGES.find((p) => p.key === key) ?? DEFAULT_MARKETING_PAGE;
}

/**
 * The address to print, for typing in by hand: no https://, and no tracking
 * tags (nobody types those) except a referral code, so a partner still gets
 * credit for a seller who typed their link off a tear-off strip.
 */
export function printedAddress(path: string, ref?: string | null): string {
  const host = PRODUCTION_ORIGIN.replace(/^https?:\/\//, "");
  const code = cleanRefCode(ref);
  return `${host}${path === "/" ? "" : path}${code ? `?ref=${code}` : ""}`;
}

/** The tagged link (and QR code) for a page. */
export function marketingLink(
  path: string,
  tags: { source?: string | null; medium?: string | null; campaign?: string | null; ref?: string | null },
): string {
  return taggedLink(PRODUCTION_ORIGIN, path, tags);
}

/** A referral partner's personal link: the sell hub with their code, on the live site. */
export function referralPartnerLink(code: string): string {
  return marketingLink(SELL_HUB_PATH, { ref: code });
}

/** "geega-qr-hub-card_show-nov-1-show" — a file name for a downloaded QR code. */
export function qrFileName(parts: Array<string | null | undefined>): string {
  const cleaned = parts.map((part) => cleanCampaignToken(part ?? "")).filter((part): part is string => !!part);
  return ["geega-qr", ...cleaned].join("-").slice(0, 120);
}

// ---------------------------------------------------------------------------
// Where leads come from
// ---------------------------------------------------------------------------

export type LeadSourceKind = "buying_lead" | "partner_lead" | "partner_application";

export interface LeadSourceSummary {
  /** leadSourceBucket's label: "Card show or event", "Google", "Referral link"… */
  source: string;
  buyingLeads: number;
  partnerLeads: number;
  partnerApplications: number;
  total: number;
  /** The tagged campaigns inside this source, most leads first. */
  campaigns: { campaign: string; count: number }[];
}

/**
 * Lead counts by source, most leads first, with "Direct or unknown" always
 * last so the sources you can act on come first.
 */
export function summarizeLeadSources(
  rows: Array<LeadSourceFields & { kind: LeadSourceKind }>,
): LeadSourceSummary[] {
  const bySource = new Map<string, LeadSourceSummary & { campaignCounts: Map<string, number> }>();
  for (const row of rows) {
    const source = leadSourceBucket(row);
    let entry = bySource.get(source);
    if (!entry) {
      entry = {
        source,
        buyingLeads: 0,
        partnerLeads: 0,
        partnerApplications: 0,
        total: 0,
        campaigns: [],
        campaignCounts: new Map(),
      };
      bySource.set(source, entry);
    }
    if (row.kind === "buying_lead") entry.buyingLeads += 1;
    else if (row.kind === "partner_lead") entry.partnerLeads += 1;
    else entry.partnerApplications += 1;
    entry.total += 1;
    if (row.utmCampaign) entry.campaignCounts.set(row.utmCampaign, (entry.campaignCounts.get(row.utmCampaign) ?? 0) + 1);
  }
  return [...bySource.values()]
    .map(({ campaignCounts, ...entry }) => ({
      ...entry,
      campaigns: [...campaignCounts.entries()]
        .map(([campaign, count]) => ({ campaign, count }))
        .sort((a, b) => b.count - a.count || a.campaign.localeCompare(b.campaign)),
    }))
    .sort((a, b) => {
      if (a.source === UNKNOWN_LEAD_SOURCE) return 1;
      if (b.source === UNKNOWN_LEAD_SOURCE) return -1;
      return b.total - a.total || a.source.localeCompare(b.source);
    });
}

/** The start of a "last N days" window, as an ISO timestamp. */
export function daysAgoIso(days: number, now = Date.now()): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}
