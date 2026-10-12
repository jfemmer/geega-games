// Where a seller came from: the tagged link or QR code they used (utm_source,
// utm_medium, utm_campaign), a personal referral code (?ref=), the first page
// of their visit and the site that sent them. Captured in the browser by
// attributionStore.ts, sent with each sell form, cleaned again on the server
// (api/_lib/attribution.ts) and stored on the lead, so the admin can see which
// card show, flyer, post or partner produced it.
//
// Pure module — no browser or Node APIs; the API imports it too.

export interface Attribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /** A personal referral code from ?ref=, not yet checked against the database. */
  ref: string | null;
  landingPath: string | null;
  referrerHost: string | null;
}

/** The same thing as database columns (referral_leads, sell_submissions, partners). */
export interface AttributionColumns {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  ref_code: string | null;
  landing_path: string | null;
  referrer_host: string | null;
}

export const EMPTY_ATTRIBUTION: Attribution = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  ref: null,
  landingPath: null,
  referrerHost: null,
};

/** "Card Show!" → "card-show". Lowercase letters, digits, dot, dash and underscore. */
export function cleanCampaignToken(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return cleaned || null;
}

/** Referral codes are 6–16 lowercase letters and digits (referral_codes.code). */
export function cleanRefCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return /^[a-z0-9]{6,16}$/.test(code) ? code : null;
}

/** A same-site path, without its query or hash. */
export function cleanLandingPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.split(/[?#]/)[0].trim();
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path.slice(0, 200);
}

export function cleanReferrerHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase();
  return /^[a-z0-9.-]{1,200}$/.test(host) ? host : null;
}

/** Cleans whatever a form sent into database columns. Anything odd becomes null. */
export function sanitizeAttribution(raw: unknown): AttributionColumns {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    utm_source: cleanCampaignToken(r.utmSource),
    utm_medium: cleanCampaignToken(r.utmMedium),
    utm_campaign: cleanCampaignToken(r.utmCampaign),
    ref_code: cleanRefCode(r.ref),
    landing_path: cleanLandingPath(r.landingPath),
    referrer_host: cleanReferrerHost(r.referrerHost),
  };
}

/** The tagged-link and referral parts of a query string. */
export function campaignFromSearch(search: string): Pick<Attribution, "utmSource" | "utmMedium" | "utmCampaign" | "ref"> {
  const params = new URLSearchParams(search);
  return {
    utmSource: cleanCampaignToken(params.get("utm_source")),
    utmMedium: cleanCampaignToken(params.get("utm_medium")),
    utmCampaign: cleanCampaignToken(params.get("utm_campaign")),
    ref: cleanRefCode(params.get("ref")),
  };
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** The site that sent the visitor, or null for a direct visit or one of our own pages. */
export function externalReferrerHost(referrer: string, ownHost: string): string | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname;
  } catch {
    return null;
  }
  if (!host || bareHost(host) === bareHost(ownHost)) return null;
  return cleanReferrerHost(host);
}

// ---------------------------------------------------------------------------
// "How did you hear about us?"
// ---------------------------------------------------------------------------

export const HEARD_ABOUT_OPTIONS = [
  "Google search",
  "Google Maps",
  "Facebook",
  "Facebook Marketplace",
  "Instagram or TikTok",
  "Card show or event",
  "Flyer or sign",
  "Friend or family",
  "Estate sale company or another professional",
  "Previous customer",
  "Other",
] as const;

export function cleanHeardAbout(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return (HEARD_ABOUT_OPTIONS as readonly string[]).includes(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Tagged links (admin Marketing page)
// ---------------------------------------------------------------------------

/** Where a tagged link or QR code will be used: utm_source, and the medium that goes with it. */
export const SOURCE_PRESETS = [
  { value: "card_show", label: "Card show or event", medium: "qr" },
  { value: "flyer", label: "Flyer or sign", medium: "print" },
  { value: "business_card", label: "Business card", medium: "print" },
  { value: "facebook", label: "Facebook post or group", medium: "social" },
  { value: "marketplace", label: "Facebook Marketplace", medium: "social" },
  { value: "craigslist", label: "Craigslist", medium: "classifieds" },
  { value: "nextdoor", label: "Nextdoor", medium: "social" },
  { value: "instagram", label: "Instagram", medium: "social" },
  { value: "tiktok", label: "TikTok", medium: "social" },
  { value: "email", label: "Email", medium: "email" },
  { value: "estate_partner", label: "Estate or referral partner", medium: "referral" },
  { value: "google_business", label: "Google Business Profile", medium: "local" },
] as const;

export type SourcePreset = (typeof SOURCE_PRESETS)[number]["value"];

export function sourceLabel(utmSource: string | null | undefined): string | null {
  if (!utmSource) return null;
  return SOURCE_PRESETS.find((p) => p.value === utmSource)?.label ?? utmSource;
}

/** `origin` + `path` with the given tags. Empty tags are left off. */
export function taggedLink(
  origin: string,
  path: string,
  tags: { source?: string | null; medium?: string | null; campaign?: string | null; ref?: string | null },
): string {
  const url = new URL(path, origin);
  const source = cleanCampaignToken(tags.source);
  const medium = cleanCampaignToken(tags.medium);
  const campaign = cleanCampaignToken(tags.campaign);
  const ref = cleanRefCode(tags.ref);
  if (source) url.searchParams.set("utm_source", source);
  if (medium) url.searchParams.set("utm_medium", medium);
  if (campaign) url.searchParams.set("utm_campaign", campaign);
  if (ref) url.searchParams.set("ref", ref);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Reading it back (admin)
// ---------------------------------------------------------------------------

export interface LeadSourceFields {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  refCode?: string | null;
  landingPath?: string | null;
  referrerHost?: string | null;
  heardAbout?: string | null;
}

/** Known referring hosts, named the way an owner would say them. */
function hostLabel(host: string): string {
  const h = bareHost(host);
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return "Google";
  if (/(^|\.)bing\.com$/.test(h)) return "Bing";
  if (/(^|\.)duckduckgo\.com$/.test(h)) return "DuckDuckGo";
  if (/(^|\.)(facebook|fb)\.com$/.test(h)) return "Facebook";
  if (/(^|\.)instagram\.com$/.test(h)) return "Instagram";
  if (/(^|\.)tiktok\.com$/.test(h)) return "TikTok";
  if (/(^|\.)reddit\.com$/.test(h)) return "Reddit";
  if (/(^|\.)craigslist\.org$/.test(h)) return "Craigslist";
  if (/(^|\.)nextdoor\.com$/.test(h)) return "Nextdoor";
  if (/(^|\.)tcgplayer\.com$/.test(h)) return "TCGplayer";
  return h;
}

/** The bucket for a lead with nothing to go on. */
export const UNKNOWN_LEAD_SOURCE = "Direct or unknown";

/** The bucket for a lead that came through someone's personal referral link. */
export const REFERRAL_LINK_SOURCE = "Referral link";

/**
 * One label per lead for the "where leads come from" counts, most specific
 * first: a referral code, then a tagged link, then the referring site, then
 * what the seller said, else UNKNOWN_LEAD_SOURCE.
 */
export function leadSourceBucket(fields: LeadSourceFields): string {
  if (fields.refCode) return REFERRAL_LINK_SOURCE;
  const tagged = sourceLabel(fields.utmSource);
  if (tagged) return tagged;
  if (fields.referrerHost) return hostLabel(fields.referrerHost);
  if (fields.heardAbout) return `Said: ${fields.heardAbout}`;
  return UNKNOWN_LEAD_SOURCE;
}

/** Plain lines describing where a lead came from, for a lead's detail view. Empty when nothing is known. */
export function describeLeadSource(fields: LeadSourceFields): string[] {
  const lines: string[] = [];
  const tagged = sourceLabel(fields.utmSource);
  if (tagged) {
    const extra = [fields.utmMedium, fields.utmCampaign].filter(Boolean).join(" · ");
    lines.push(`Tagged link: ${tagged}${extra ? ` (${extra})` : ""}`);
  }
  if (fields.refCode) lines.push(`Referral code: ${fields.refCode}`);
  if (fields.referrerHost) lines.push(`Came from: ${hostLabel(fields.referrerHost)}`);
  if (fields.landingPath) lines.push(`First page: ${fields.landingPath}`);
  if (fields.heardAbout) lines.push(`Said they heard about us from: ${fields.heardAbout}`);
  return lines;
}
