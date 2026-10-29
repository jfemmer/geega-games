import { createHmac } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { optionalEnv, ServerEnv } from "./_lib/env.js";
import { readRawBody } from "./_lib/http.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import { isMetaNetwork } from "./_lib/metaNetwork.js";
import type { TablesInsert } from "../src/types/database.js";

// POST /api/track — one storefront page view, one shop search, or one
// seller-form progress report (src/store/lib/pageViews.ts,
// src/store/lib/searchTracking.ts, src/store/lib/formTracking.ts).
//
// Privacy by design (see migrations 20260924070000 and 20261027050000):
//   * Stores no IP, no cookie, no user id. The visitor is an HMAC of
//     (UTC day, IP, user agent) with a server-only key: stable for one day,
//     then unlinkable, and not reversible without the key.
//   * Stores the path WITHOUT its query string (which could carry emails or
//     tokens), the referring site's hostname only, the campaign tags of the
//     link the visitor arrived on (utm_source / utm_medium / utm_campaign,
//     cleaned to short slugs), whether they interacted with the page, the
//     visitor's approximate country / state / city (from Vercel's edge
//     geo-IP headers — the IP itself is never stored) and a coarse device.
//   * A search stores the lower-cased query (80 characters at most) and how
//     many cards it found; anything that looks like an email address or a
//     phone number is dropped, here and in the browser.
//   * Bots, Meta's own servers (link previews and checks from Facebook's
//     network) and /admin pages are dropped here; staff, automated
//     browsers, Do Not Track and Global Privacy Control are dropped in the
//     browser before anything is sent.
//
// Always answers 204 (even when a view is ignored) so the endpoint reveals
// nothing and a failure can never affect the page.

export const config = { api: { bodyParser: false } };

const BOT_UA =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|meta-external|embedly|quora link preview|whatsapp|telegram|discord|slack|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\//i;

function deviceFrom(ua: string): "mobile" | "tablet" | "desktop" {
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return "mobile";
  return "desktop";
}

/** "/shop?sort=new#x" → "/shop"; rejects anything that isn't a site path. */
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const path = raw.split(/[?#]/)[0].replace(/\/{2,}/g, "/");
  if (path.length > 300) return null;
  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin_dashboard") || path.startsWith("/api/")) {
    return null;
  }
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** Hostname of an external referrer, or null for direct / same-site. */
export function referrerHost(raw: unknown, ownHost: string | undefined): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    const own = (ownHost ?? "").toLowerCase().split(":")[0].replace(/^www\./, "");
    if (!host || host === own) return null;
    return host.slice(0, 255);
  } catch {
    return null;
  }
}

/** A campaign tag as a short slug ("Fall Sale!" → "fall-sale"), or null. */
export function cleanUtm(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
  return slug || null;
}

/** Looks like someone typed an email address or a phone number. */
export function looksPersonal(text: string): boolean {
  return text.includes("@") || /\d[\d\s().-]{6,}\d/.test(text);
}

/** A shop search as stored: trimmed, lower-cased, single-spaced, 2–80 characters, nothing personal. */
export function cleanSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80).trim();
  if (q.length < 2 || looksPersonal(q)) return null;
  return q;
}

const TRACKED_FORMS = new Set(["quick_quote", "sell", "referral"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A form or step name, or one of our error messages: no control characters, single-spaced, capped. */
function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return text || null;
}

function smallCount(raw: unknown, max: number): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? Math.min(raw, max) : 0;
}

export interface FormProgress {
  id: string;
  form: string;
  path: string;
  step: number;
  stepLabel: string | null;
  field: string | null;
  photos: number;
  attempts: number;
  error: string | null;
  submitted: boolean;
}

/**
 * One seller-form progress report (src/store/lib/formTracking.ts), checked
 * and cleaned, or null to ignore it. Field and step names and error messages
 * are our own wording; anything that still looks like an email address or a
 * phone number is dropped rather than stored.
 */
export function cleanFormProgress(body: TrackBody): FormProgress | null {
  const id = typeof body.id === "string" && UUID_RE.test(body.id) ? body.id.toLowerCase() : null;
  const form = typeof body.f === "string" && TRACKED_FORMS.has(body.f) ? body.f : null;
  const path = cleanPath(body.p);
  const step = typeof body.s === "number" && Number.isInteger(body.s) && body.s >= 1 && body.s <= 10 ? body.s : null;
  if (!id || !form || !path || step === null) return null;
  const notPersonal = (text: string | null) => (text && !looksPersonal(text) ? text : null);
  return {
    id,
    form,
    path,
    step,
    stepLabel: notPersonal(cleanText(body.sl, 80)),
    field: notPersonal(cleanText(body.fl, 80)),
    photos: smallCount(body.ph, 1000),
    attempts: smallCount(body.a, 1000),
    error: notPersonal(cleanText(body.er, 300)),
    submitted: body.ok === true,
  };
}

function header(req: VercelRequest, name: string): string | null {
  const v = req.headers[name];
  return typeof v === "string" && v ? v : null;
}

/** Vercel's region code: ISO 3166-2 subdivision without the country, e.g. "MO". */
export function cleanRegion(raw: string | null): string | null {
  return raw && /^[A-Z0-9]{1,3}$/.test(raw) ? raw : null;
}

/** Vercel URL-encodes the city ("S%C3%A3o%20Paulo"); decode and sanity-check it. */
export function cleanCity(raw: string | null): string | null {
  if (!raw) return null;
  let city: string;
  try {
    city = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  city = city.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return city && city.length <= 100 ? city : null;
}

function visitorHash(ip: string, ua: string): string {
  const key = optionalEnv("ANALYTICS_SALT") || ServerEnv.emailTokenSecret();
  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", key).update(`${day}|${ip}|${ua}`).digest("hex").slice(0, 32);
}

interface TrackBody {
  /** "s": a shop search; "e": a page view sent without interaction got one; a page view otherwise. */
  t?: unknown;
  p?: unknown;
  r?: unknown;
  /** The visitor scrolled, tapped, typed or moved the mouse on the page. */
  e?: unknown;
  /** Campaign tags of the landing page's link: source, medium, campaign. */
  u?: { s?: unknown; m?: unknown; c?: unknown } | null;
  q?: unknown;
  n?: unknown;
  /** A search: filters were on. A form report ("f"): which form. */
  f?: unknown;
  d?: unknown;
  /** Form report: session id, step, step name, last field, photos, send attempts, error shown, sent. */
  id?: unknown;
  s?: unknown;
  sl?: unknown;
  fl?: unknown;
  ph?: unknown;
  a?: unknown;
  er?: unknown;
  ok?: unknown;
}

type PageViewRow = TablesInsert<"site_page_views">;
/** The columns added by the 20261027050000 database update. */
type NewerPageViewColumns = Pick<PageViewRow, "engaged" | "utm_source" | "utm_medium" | "utm_campaign">;

async function insertPageView(row: Omit<PageViewRow, keyof NewerPageViewColumns>, newer: NewerPageViewColumns) {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("site_page_views").insert({ ...row, ...newer });
  if (!error) return;
  // Until that database update runs, the newer columns don't exist: keep
  // recording views the way it always did.
  if (/engaged|utm_/.test(error.message ?? "")) {
    const retry = await admin.from("site_page_views").insert(row);
    if (!retry.error) return;
    console.error("[track] insert failed", retry.error.message);
    return;
  }
  console.error("[track] insert failed", error.message);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  res.setHeader("Cache-Control", "no-store");

  try {
    const ua = String(req.headers["user-agent"] ?? "").slice(0, 400);
    if (!ua || BOT_UA.test(ua)) return res.status(204).end();

    const ip = getClientIp(req);
    // Facebook's own servers checking a link: not a person.
    if (isMetaNetwork(ip)) return res.status(204).end();
    // Generous for real browsing, but stops one client inflating the numbers.
    if (!checkRateLimit("track", ip, 60, 60_000).allowed) return res.status(204).end();

    let body: TrackBody;
    try {
      body = JSON.parse(await readRawBody(req, 2048));
    } catch {
      return res.status(204).end();
    }
    if (!body || typeof body !== "object") return res.status(204).end();

    if (body.t === "s") {
      const query = cleanSearchQuery(body.q);
      const results = typeof body.n === "number" && Number.isInteger(body.n) && body.n >= 0 && body.n <= 1_000_000 ? body.n : null;
      if (!query || results === null) return res.status(204).end();
      const { error } = await getSupabaseAdmin().from("site_searches").insert({
        visitor_hash: visitorHash(ip, ua),
        query,
        results,
        filtered: body.f === true,
        deals: body.d === true,
        device: deviceFrom(ua),
      });
      if (error) console.error("[track] search insert failed", error.message);
      return res.status(204).end();
    }

    if (body.t === "f") {
      const progress = cleanFormProgress(body);
      if (!progress) return res.status(204).end();
      const countryHeader = header(req, "x-vercel-ip-country");
      const { error } = await getSupabaseAdmin().rpc("record_form_session", {
        p_id: progress.id,
        p_form: progress.form,
        p_path: progress.path,
        p_visitor_hash: visitorHash(ip, ua),
        p_device: deviceFrom(ua),
        p_country: countryHeader && /^[A-Z]{2}$/.test(countryHeader) ? countryHeader : null,
        p_region: cleanRegion(header(req, "x-vercel-ip-country-region")),
        p_city: cleanCity(header(req, "x-vercel-ip-city")),
        p_step: progress.step,
        p_step_label: progress.stepLabel,
        p_field: progress.field,
        p_photos: progress.photos,
        p_attempts: progress.attempts,
        p_error: progress.error,
        p_submitted: progress.submitted,
      });
      if (error) console.error("[track] form progress failed", error.message);
      return res.status(204).end();
    }

    const path = cleanPath(body.p);
    if (!path) return res.status(204).end();

    if (body.t === "e") {
      // A visitor who left a page without interacting came back and did:
      // their view of it (same anonymous id, last two hours) is engaged.
      const since = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      const { error } = await getSupabaseAdmin()
        .from("site_page_views")
        .update({ engaged: true })
        .eq("visitor_hash", visitorHash(ip, ua))
        .eq("path", path)
        .eq("engaged", false)
        .gte("viewed_at", since);
      if (error) console.error("[track] engagement update failed", error.message);
      return res.status(204).end();
    }

    const countryHeader = header(req, "x-vercel-ip-country");
    const country = countryHeader && /^[A-Z]{2}$/.test(countryHeader) ? countryHeader : null;
    const utm = body.u && typeof body.u === "object" ? body.u : null;

    await insertPageView(
      {
        visitor_hash: visitorHash(ip, ua),
        path,
        referrer_host: referrerHost(body.r, req.headers.host),
        country,
        region: cleanRegion(header(req, "x-vercel-ip-country-region")),
        city: cleanCity(header(req, "x-vercel-ip-city")),
        device: deviceFrom(ua),
      },
      {
        // Older pages still open in a browser don't send it: unknown.
        engaged: typeof body.e === "boolean" ? body.e : null,
        utm_source: cleanUtm(utm?.s, 60),
        utm_medium: cleanUtm(utm?.m, 60),
        utm_campaign: cleanUtm(utm?.c, 80),
      },
    );
  } catch (err) {
    console.error("[track] failed", err);
  }
  return res.status(204).end();
}
