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
import { optionalUser } from "../_lib/requestUser.js";

// POST /api/stock-alerts/hold-watch
// Body: { inventoryItemId: string, email?: string, website?: string /* honeypot */ }
//
// "Notify me if it's released" for a copy a trade is holding (see
// trade_held_copies). Public, no login: a signed-in shopper's account email
// is used (and their account noted); a guest gives an email. Same shape as
// /api/stock-alerts/subscribe: honeypot, rate limit, upsert so asking again
// just re-arms the same row. api/stock-alerts/process.ts sends the one email
// once the copy can be bought again.
//
// Replies { ok: true, status }:
//   "watching"   saved;
//   "available"  nothing is holding it any more: buy it now (nothing saved).
// A copy that isn't for sale any more is a 404.

const RATE_LIMIT_PER_WINDOW = 8;
const RATE_WINDOW_MS = 10 * 60_000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type HeldRow = { id: string; card_name: string; held_quantity: number; sellable_quantity: number };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("trade-hold-watch", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
    }

    requireJsonContentType(req);
    const body = await readJsonBody(req);

    const honeypot = typeof body.website === "string" ? body.website.trim() : "";
    if (honeypot.length > 0) return sendJson(res, 200, { ok: true, status: "watching" });

    const itemId = body.inventoryItemId;
    if (typeof itemId !== "string" || !ID_RE.test(itemId)) {
      throw new HttpError(400, "That card couldn't be identified.");
    }

    const user = await optionalUser(req);
    const email = user?.email ? normalizeEmail(user.email) : normalizeEmail(body.email);
    if (!email) throw new HttpError(400, "Please enter a valid email address.");

    const admin = getSupabaseAdmin();
    const { data: held, error: heldErr } = await admin.rpc("trade_held_copies", {
      p_oracle_id: null,
      p_ids: [itemId],
    });
    if (heldErr) {
      console.error("[/api/stock-alerts/hold-watch] lookup failed:", heldErr);
      throw new HttpError(500, "Something went wrong on our end. Please try again shortly.");
    }
    const row = ((held ?? []) as HeldRow[]).find((r) => r.id === itemId);
    if (!row) {
      // No trade is holding it: either it's for sale again, or it's gone.
      const { data: item } = await admin
        .from("inventory_items")
        .select("id, status, quantity")
        .eq("id", itemId)
        .maybeSingle();
      if (item && item.status === "active" && (item.quantity ?? 0) > 0) {
        return sendJson(res, 200, { ok: true, status: "available" });
      }
      throw new HttpError(404, "That copy isn't for sale any more.");
    }
    if (row.sellable_quantity > 0) return sendJson(res, 200, { ok: true, status: "available" });

    const { error } = await admin.from("trade_hold_watchers").upsert(
      {
        inventory_item_id: itemId,
        card_name: row.card_name.slice(0, 200),
        email,
        user_id: user?.id ?? null,
        created_at: new Date().toISOString(),
        notified_at: null,
        closed_at: null,
        closed_reason: null,
      },
      { onConflict: "inventory_item_id,email" },
    );
    if (error) {
      console.error("[/api/stock-alerts/hold-watch] upsert failed:", error);
      throw new HttpError(500, "Something went wrong on our end. Please try again shortly.");
    }
    return sendJson(res, 200, { ok: true, status: "watching" });
  } catch (err) {
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { ok: false, message: err.message });
    }
    console.error("[/api/stock-alerts/hold-watch] error:", err);
    return sendJson(res, 500, { ok: false, message: "Something went wrong on our end. Please try again shortly." });
  }
}
