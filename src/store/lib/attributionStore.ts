import { useEffect } from "react";
import { useRouter } from "./router";
import {
  EMPTY_ATTRIBUTION,
  campaignFromSearch,
  cleanLandingPath,
  externalReferrerHost,
  type Attribution,
} from "./attribution";

// Remembers where this visitor came from, for 30 days, so a seller who scans a
// card-show QR code today and fills in the form next week is still credited to
// that card show. Sell forms read it with getAttribution().
//
//   * A tagged link (utm_*) replaces what was remembered: the latest campaign
//     the visitor came through is the one that gets the credit.
//   * A ?ref= code is kept alongside, and replaced only by another ?ref=.
//   * An ordinary visit (no tags) never overwrites an earlier one, so the
//     first page and referring site of the visit that started it all stick.
//
// localStorage only; when it's blocked nothing is remembered and forms just
// send nothing. No cookies, nothing sent anywhere until a form is submitted.

const STORAGE_KEY = "gg.attribution.v1";
export const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Stored extends Attribution {
  at: number;
}

function read(now: number): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored> | null;
    if (!parsed || typeof parsed.at !== "number" || now - parsed.at > ATTRIBUTION_TTL_MS) return null;
    return { ...EMPTY_ATTRIBUTION, ...parsed, at: parsed.at } as Stored;
  } catch {
    return null;
  }
}

function write(value: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage blocked — nothing is remembered */
  }
}

export interface VisitLocation {
  pathname: string;
  search: string;
  referrer: string;
  /** This site's hostname, so our own pages never count as a referrer. */
  host: string;
}

/** Records one page view's worth of attribution. Exported for tests. */
export function recordVisit(location: VisitLocation, now: number = Date.now()): void {
  const campaign = campaignFromSearch(location.search);
  const tagged = Boolean(campaign.utmSource || campaign.utmMedium || campaign.utmCampaign);
  const stored = read(now);

  // An ordinary page view while we already remember a visit: keep the first one.
  if (stored && !tagged && !campaign.ref) return;

  const next: Stored = stored ? { ...stored } : { ...EMPTY_ATTRIBUTION, at: now };
  if (!stored || tagged) {
    next.utmSource = campaign.utmSource;
    next.utmMedium = campaign.utmMedium;
    next.utmCampaign = campaign.utmCampaign;
    next.landingPath = cleanLandingPath(location.pathname);
    next.referrerHost = externalReferrerHost(location.referrer, location.host);
  }
  if (campaign.ref) next.ref = campaign.ref;
  next.at = now;
  write(next);
}

/** What to send with a sell form, or null when nothing is remembered. */
export function getAttribution(now: number = Date.now()): Attribution | null {
  const stored = read(now);
  if (!stored) return null;
  const { at: _at, ...attribution } = stored;
  return attribution;
}

/** Mounted once in the storefront: records each page the visitor lands on. */
export function AttributionTracker(): null {
  const { path, query } = useRouter();
  const search = query.toString();
  useEffect(() => {
    recordVisit({
      pathname: window.location.pathname,
      search: window.location.search,
      referrer: document.referrer,
      host: window.location.hostname,
    });
  }, [path, search]);
  return null;
}
