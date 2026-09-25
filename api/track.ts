import { createHmac } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { optionalEnv, ServerEnv } from "./_lib/env.js";
import { readRawBody } from "./_lib/http.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";

// POST /api/track — one storefront page view (src/store/lib/pageViews.ts).
//
// Privacy by design (see migration 20260924070000):
//   * Stores no IP, no cookie, no user id. The visitor is an HMAC of
//     (UTC day, IP, user agent) with a server-only key: stable for one day,
//     then unlinkable, and not reversible without the key.
//   * Stores the path WITHOUT its query string (which could carry emails or
//     tokens), the referring site's hostname only, the visitor's approximate
//     country / state / city (from Vercel's edge geo-IP headers — the IP
//     itself is never stored) and a coarse device type.
//   * Bots and /admin pages are dropped here; staff, Do Not Track and Global
//     Privacy Control are dropped in the browser before anything is sent.
//
// Always answers 204 (even when a view is ignored) so the endpoint reveals
// nothing and a failure can never affect the page.

export const config = { api: { bodyParser: false } };

const BOT_UA =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|slack|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\//i;

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
    // Generous for real browsing, but stops one client inflating the numbers.
    if (!checkRateLimit("track", ip, 60, 60_000).allowed) return res.status(204).end();

    let body: { p?: unknown; r?: unknown };
    try {
      body = JSON.parse(await readRawBody(req, 2048));
    } catch {
      return res.status(204).end();
    }

    const path = cleanPath(body.p);
    if (!path) return res.status(204).end();

    const countryHeader = header(req, "x-vercel-ip-country");
    const country = countryHeader && /^[A-Z]{2}$/.test(countryHeader) ? countryHeader : null;

    const { error } = await getSupabaseAdmin().from("site_page_views").insert({
      visitor_hash: visitorHash(ip, ua),
      path,
      referrer_host: referrerHost(body.r, req.headers.host),
      country,
      region: cleanRegion(header(req, "x-vercel-ip-country-region")),
      city: cleanCity(header(req, "x-vercel-ip-city")),
      device: deviceFrom(ua),
    });
    if (error) console.error("[track] insert failed", error.message);
  } catch (err) {
    console.error("[track] failed", err);
  }
  return res.status(204).end();
}
