import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { normalizeEmail } from "./_lib/tokens.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import {
  notifyStaffOfPhotoRequest,
  sendPhotoRequestConfirmation,
} from "./_lib/photoRequestEmails.js";
import { PHOTO_REQUEST_MAX_NOTE } from "../src/store/lib/photoRequestTypes.js";
import type { Database } from "../src/types/database.js";

// POST /api/photo-requests
//
// PUBLIC, guest-submittable. A shopper on a card page asks for a photo of
// the actual copy of one listing (the storefront shows stock images). We
// store the request, notify staff (admin notification bell + push) and send
// the shopper a receipt; staff answer from Inventory → Photo requests.
//
// Trust boundaries (same as /api/referral-leads):
//   - no anon INSERT policy on photo_requests — every write is here, with the
//     service_role key;
//   - the card details are looked up from inventory_items by id, never taken
//     from the client, so a request can't be made to look like any card;
//   - the card link stored for the email must be one of our own card paths.

type PhotoRequestInsert = Database["public"]["Tables"]["photo_requests"]["Insert"];

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_PER_WINDOW = 6;
const RATE_WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS_PER_EMAIL_PER_HOUR = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_PATH_RE = /^\/shop\/card\/[a-z0-9-]{1,200}$/;

interface Body {
  inventoryItemId?: unknown;
  firstName?: unknown;
  email?: unknown;
  note?: unknown;
  cardPath?: unknown;
  /** Honeypot: hidden from people, filled in by bots. */
  website?: unknown;
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
    const rl = checkRateLimit("photo-requests", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a bit and try again.");
    }

    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Body;

    // A real person never fills the honeypot. Look successful, store nothing.
    if (cleanString(body.website, 200)) {
      return sendJson(res, 200, { ok: true, referenceNumber: "GG-P-0000" });
    }

    const itemId = typeof body.inventoryItemId === "string" ? body.inventoryItemId : "";
    if (!UUID_RE.test(itemId)) throw new HttpError(400, "Please choose which listing you'd like a photo of.");

    const firstName = cleanString(body.firstName, 100);
    const email = normalizeEmail(body.email);
    if (!firstName || !email) {
      throw new HttpError(400, "Please enter your first name and a valid email so we can send the photo.");
    }
    const note = cleanString(body.note, PHOTO_REQUEST_MAX_NOTE);
    const cardPathRaw = cleanString(body.cardPath, 300);
    const cardPath = cardPathRaw && CARD_PATH_RE.test(cardPathRaw) ? cardPathRaw : null;

    const admin = getSupabaseAdmin();

    const { data: item, error: itemErr } = await admin
      .from("inventory_items")
      .select("id, card_name, set_code, set_name, collector_number, condition, finish, status, quantity")
      .eq("id", itemId)
      .maybeSingle();
    if (itemErr) throw new HttpError(500, "We couldn't look up that card. Please try again.");
    if (!item || item.status !== "active" || item.quantity <= 0) {
      throw new HttpError(404, "That listing isn't available anymore. Please refresh the page.");
    }

    // Asking twice about the same listing doesn't create a second request.
    const { data: existing } = await admin
      .from("photo_requests")
      .select("reference_number")
      .eq("email", email)
      .eq("inventory_item_id", item.id)
      .eq("status", "new")
      .limit(1)
      .maybeSingle();
    if (existing) {
      return sendJson(res, 200, { ok: true, referenceNumber: existing.reference_number, duplicate: true });
    }

    // Survives cold starts, unlike the per-instance IP limit above.
    const { count: recentFromEmail } = await admin
      .from("photo_requests")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());
    if ((recentFromEmail ?? 0) >= MAX_REQUESTS_PER_EMAIL_PER_HOUR) {
      throw new HttpError(
        429,
        "You've sent several photo requests in the last hour. We'll answer those first — or email us directly.",
      );
    }

    const insert: PhotoRequestInsert = {
      inventory_item_id: item.id,
      card_name: item.card_name,
      set_code: item.set_code,
      set_name: item.set_name,
      collector_number: item.collector_number,
      condition: item.condition,
      finish: item.finish,
      card_path: cardPath,
      first_name: firstName,
      email,
      note,
    };

    const { data: request, error } = await admin
      .from("photo_requests")
      .insert(insert)
      .select("id, reference_number")
      .single();
    if (error || !request) {
      console.error("[/api/photo-requests] insert failed:", error);
      throw new HttpError(500, "We couldn't save your request. Please try again.");
    }

    // Best-effort: the request is saved either way; both are idempotent.
    await notifyStaffOfPhotoRequest(request.id);
    try {
      await sendPhotoRequestConfirmation(request.id);
    } catch (err) {
      console.error("[/api/photo-requests] confirmation email failed:", err, "request:", request.id);
    }

    return sendJson(res, 200, { ok: true, referenceNumber: request.reference_number });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/photo-requests] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
