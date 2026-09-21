import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  requireJsonContentType,
  sendJson,
} from "../_lib/http.js";
import { normalizeEmail } from "../_lib/tokens.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";

// POST /api/stock-alerts/subscribe
// Body: { oracleId: string, cardName: string, email: string, website?: string /* honeypot */ }
//
// Public, no login — "notify me when this card is back in stock" from a
// card detail page. Same shape as /api/subscribe: honeypot, rate limit,
// generic success response regardless of whether this is a new or repeat
// subscription, so the endpoint never reveals anything about who else has
// asked. Resubscribing after already being notified once just resets the
// same row back to pending (see the upsert below).

const RATE_LIMIT_PER_WINDOW = 8;
const RATE_WINDOW_MS = 10 * 60_000;

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("stock-alert-subscribe", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
    }

    requireJsonContentType(req);
    const body = await readJsonBody(req);

    const honeypot = typeof body.website === "string" ? body.website.trim() : "";
    if (honeypot.length > 0) {
      return sendJson(res, 200, { ok: true });
    }

    const oracleId = body.oracleId;
    if (!isUuid(oracleId)) {
      throw new HttpError(400, "That card couldn't be identified.");
    }
    const cardName =
      typeof body.cardName === "string" && body.cardName.trim()
        ? body.cardName.trim().slice(0, 200)
        : "This card";
    const email = normalizeEmail(body.email);
    if (!email) {
      throw new HttpError(400, "Please enter a valid email address.");
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin.from("card_stock_subscriptions").upsert(
      {
        oracle_id: oracleId,
        card_name: cardName,
        email,
        notified_at: null,
        created_at: new Date().toISOString(),
      },
      { onConflict: "oracle_id,email" },
    );
    if (error) {
      console.error("[/api/stock-alerts/subscribe] upsert failed:", error);
      throw new HttpError(500, "Something went wrong on our end. Please try again shortly.");
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { ok: false, message: err.message });
    }
    console.error("[/api/stock-alerts/subscribe] error:", err);
    return sendJson(res, 500, {
      ok: false,
      message: "Something went wrong on our end. Please try again shortly.",
    });
  }
}
