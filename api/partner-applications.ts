import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { normalizeEmail } from "./_lib/tokens.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import { sendPartnerApplicationEmails } from "./_lib/partnerEmails.js";
import { cleanWebsite } from "./_lib/partners.js";
import { sanitizeAttribution } from "../src/store/lib/attribution.js";
import {
  defaultFeePercent,
  isPartnerCategory,
  isPartnerKind,
  isPartnerProfession,
} from "../src/store/lib/partnerTypes.js";
import { usStateCode } from "../src/store/lib/usAddress.js";
import type { Database } from "../src/types/database.js";

// POST /api/partner-applications
//
// PUBLIC: the application forms on /for-stores (partner stores, who buy the
// leads) and /referral-partners (estate sale companies, attorneys, realtors…
// who send sellers to us). Stores the application as a partners row with
// status 'applied' — nothing is sent anywhere until staff approve it on the
// admin Partners page — and emails staff and the applicant.
//
// Same trust boundaries as /api/referral-leads: no anon write policy on
// partners (every write is here, with the service_role key), a honeypot, an
// IP rate limit and a per-email limit that survives cold starts.

type PartnerInsert = Database["public"]["Tables"]["partners"]["Insert"];

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_PER_WINDOW = 5;
const RATE_WINDOW_MS = 10 * 60_000;
const MAX_APPLICATIONS_PER_EMAIL_PER_DAY = 3;

interface Body {
  kind?: unknown;
  businessName?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  website?: unknown;
  city?: unknown;
  state?: unknown;
  categories?: unknown;
  coverage?: unknown;
  buysByMail?: unknown;
  profession?: unknown;
  notes?: unknown;
  agreed?: unknown;
  attribution?: unknown;
  /** Honeypot: hidden from people, filled in by bots. */
  fax?: unknown;
}

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("partner-applications", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a bit and try again.");
    }

    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Body;

    // A real person never fills the honeypot. Look successful, store nothing.
    if (cleanString(body.fax, 200)) return sendJson(res, 200, { ok: true });

    if (!isPartnerKind(body.kind)) throw new HttpError(400, "Please choose what kind of partner you are.");
    const kind = body.kind;

    if (body.agreed !== true) {
      throw new HttpError(
        400,
        kind === "store"
          ? "Please confirm your store will follow the partner standards."
          : "Please confirm you'll only share our link with people who want an offer.",
      );
    }

    const businessName = cleanString(body.businessName, 200);
    const contactName = cleanString(body.contactName, 200);
    const email = normalizeEmail(body.email);
    if (!businessName || !contactName || !email) {
      throw new HttpError(400, "Please give your business name, your name and a valid email.");
    }

    const city = cleanString(body.city, 120);
    const state = usStateCode(body.state);
    if (!city || !state) throw new HttpError(400, "Please give your city and state.");

    const categories = Array.isArray(body.categories)
      ? [...new Set(body.categories.filter(isPartnerCategory))]
      : [];
    if (kind === "store" && categories.length === 0) {
      throw new HttpError(400, "Please choose what your store buys.");
    }
    const profession = isPartnerProfession(body.profession) ? body.profession : null;
    if (kind === "referrer" && !profession) throw new HttpError(400, "Please choose what you do.");

    const admin = getSupabaseAdmin();

    const { count: recentFromEmail } = await admin
      .from("partners")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    if ((recentFromEmail ?? 0) >= MAX_APPLICATIONS_PER_EMAIL_PER_DAY) {
      throw new HttpError(
        429,
        "We've already received an application from this email today. We'll be in touch — or just email us.",
      );
    }

    const attribution = sanitizeAttribution(body.attribution);
    const insert: PartnerInsert = {
      kind,
      status: "applied",
      business_name: businessName,
      contact_name: contactName,
      email,
      phone: cleanString(body.phone, 30),
      website: cleanWebsite(body.website),
      city,
      state,
      categories: kind === "store" ? categories : [],
      coverage: kind === "store" ? cleanString(body.coverage, 1000) : null,
      buys_by_mail: kind === "store" && body.buysByMail === true,
      profession: kind === "referrer" ? profession : null,
      notes: cleanString(body.notes, 2000),
      fee_percent: defaultFeePercent(kind),
      agreed_to_standards_at: new Date().toISOString(),
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      landing_path: attribution.landing_path,
      referrer_host: attribution.referrer_host,
    };

    const { data: partner, error } = await admin.from("partners").insert(insert).select("id").single();
    if (error || !partner) {
      console.error("[/api/partner-applications] insert failed:", error);
      throw new HttpError(500, "We couldn't save your application. Please try again.");
    }

    // Best-effort: the application is saved either way, and both sends are idempotent.
    try {
      await sendPartnerApplicationEmails(partner.id);
    } catch (err) {
      console.error("[/api/partner-applications] emails failed:", err, "partner:", partner.id);
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/partner-applications] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
