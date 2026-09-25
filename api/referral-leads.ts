import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { normalizeEmail } from "./_lib/tokens.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import { isValidDraftId, listDraftPhotos } from "./_lib/sell.js";
import {
  sendReferralLeadAdminNotification,
  sendReferralLeadConfirmation,
} from "./_lib/referralLeadEmails.js";
import {
  REFERRAL_CONTACT_METHODS,
  REFERRAL_HANDOFF_OPTIONS,
  REFERRAL_MAX_DESCRIPTION,
  REFERRAL_MAX_PHOTOS,
  REFERRAL_SIZE_OPTIONS,
  isReferralCategory,
} from "../src/store/lib/referralTypes.js";
import type { Database } from "../src/types/database.js";

// POST /api/referral-leads
//
// PUBLIC, guest-submittable lead form for people selling Pokémon cards, One
// Piece cards or video games (/sell-pokemon-cards, /sell-one-piece-cards,
// /sell-video-games). Geega Games doesn't buy these itself: it stores the
// lead, emails staff everything needed to forward it to the buying partner,
// and sends the seller a receipt.
//
// Trust boundaries (same as /api/sell/submit):
//   - no anon INSERT policy exists on referral_leads — every write is here,
//     with the service_role key;
//   - consent to share with the partner is REQUIRED (privacy policy: third
//     parties only with consent) and is recorded as a timestamp;
//   - photo paths are only stored if Storage confirms the object exists under
//     the submitted draft prefix — a client can't attach files it never
//     uploaded, or someone else's.

type ReferralLeadInsert = Database["public"]["Tables"]["referral_leads"]["Insert"];

const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_PER_WINDOW = 5;
const RATE_WINDOW_MS = 10 * 60_000;
const MAX_LEADS_PER_EMAIL_PER_HOUR = 3;

const SIZES = new Set<string>(REFERRAL_SIZE_OPTIONS.map((o) => o.value));
const HANDOFFS = new Set<string>(REFERRAL_HANDOFF_OPTIONS.map((o) => o.value));
const CONTACT_METHODS = new Set<string>(REFERRAL_CONTACT_METHODS.map((o) => o.value));

interface Body {
  categories?: unknown;
  description?: unknown;
  size?: unknown;
  handoff?: unknown;
  contact?: {
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    phone?: unknown;
    preferredContactMethod?: unknown;
    location?: unknown;
  };
  draftId?: unknown;
  photos?: unknown;
  consent?: unknown;
  sourcePath?: unknown;
  /** Honeypot: hidden from people, filled in by bots. */
  website?: unknown;
}

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

function pick(v: unknown, allowed: Set<string>): string | null {
  return typeof v === "string" && allowed.has(v) ? v : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("referral-leads", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a bit and try again.");
    }

    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Body;

    // A real person never fills the honeypot. Look successful, store nothing.
    if (cleanString(body.website, 200)) {
      return sendJson(res, 200, { ok: true, referenceNumber: "GG-R-000000" });
    }

    if (body.consent !== true) {
      throw new HttpError(
        400,
        "Please confirm we can share your details with our buying partner so they can contact you.",
      );
    }

    const categories = Array.isArray(body.categories)
      ? [...new Set(body.categories.filter(isReferralCategory))]
      : [];
    if (categories.length === 0) {
      throw new HttpError(400, "Please choose what you're selling.");
    }

    const description = cleanString(body.description, REFERRAL_MAX_DESCRIPTION);
    if (!description) {
      throw new HttpError(400, "Please tell us a little about what you have.");
    }

    const contact = body.contact ?? {};
    const firstName = cleanString(contact.firstName, 100);
    const email = normalizeEmail(contact.email);
    if (!firstName || !email) {
      throw new HttpError(400, "Please provide your first name and a valid email.");
    }
    const phone = cleanString(contact.phone, 30);
    const preferredContactMethod = pick(contact.preferredContactMethod, CONTACT_METHODS) ?? "email";
    if ((preferredContactMethod === "phone" || preferredContactMethod === "text") && !phone) {
      throw new HttpError(400, "Please add a phone number, or choose email as your contact method.");
    }

    const admin = getSupabaseAdmin();

    // Photos: keep only paths Storage confirms exist under this draft.
    let photoPaths: string[] = [];
    if (isValidDraftId(body.draftId) && Array.isArray(body.photos)) {
      const draftId = body.draftId;
      const confirmed = new Set((await listDraftPhotos(admin, draftId)).map((f) => f.name));
      photoPaths = body.photos
        .map((p) => (p && typeof p === "object" ? (p as { path?: unknown }).path : null))
        .filter((path): path is string => typeof path === "string" && path.startsWith(`${draftId}/`))
        .filter((path) => confirmed.has(path.slice(draftId.length + 1)))
        .slice(0, REFERRAL_MAX_PHOTOS);
    }

    // Survives cold starts, unlike the per-instance IP limit above.
    const { count: recentFromEmail } = await admin
      .from("referral_leads")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
    if ((recentFromEmail ?? 0) >= MAX_LEADS_PER_EMAIL_PER_HOUR) {
      throw new HttpError(
        429,
        "We've already received a request from this email recently. If you need help, please contact us directly.",
      );
    }

    const insert: ReferralLeadInsert = {
      categories,
      description,
      collection_size: pick(body.size, SIZES),
      handoff: pick(body.handoff, HANDOFFS) ?? "not_sure",
      first_name: firstName,
      last_name: cleanString(contact.lastName, 100),
      email,
      phone,
      preferred_contact_method: preferredContactMethod,
      location: cleanString(contact.location, 120),
      photo_paths: photoPaths,
      source_path: cleanString(body.sourcePath, 200),
      consent_to_share_at: new Date().toISOString(),
    };

    const { data: lead, error } = await admin
      .from("referral_leads")
      .insert(insert)
      .select("id, reference_number")
      .single();
    if (error || !lead) {
      console.error("[/api/referral-leads] insert failed:", error);
      throw new HttpError(500, "We couldn't save your request. Please try again.");
    }

    // Best-effort: the lead is saved either way, and both sends are idempotent.
    try {
      await sendReferralLeadAdminNotification(lead.id);
    } catch (err) {
      console.error("[/api/referral-leads] staff email failed:", err, "lead:", lead.id);
    }
    try {
      await sendReferralLeadConfirmation(lead.id);
    } catch (err) {
      console.error("[/api/referral-leads] confirmation email failed:", err, "lead:", lead.id);
    }

    return sendJson(res, 200, { ok: true, referenceNumber: lead.reference_number });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/referral-leads] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
