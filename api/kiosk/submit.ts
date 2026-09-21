import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { checkRateLimit, getClientIp } from "../_lib/rateLimit.js";
import { normalizeEmail } from "../_lib/tokens.js";

// POST /api/kiosk/submit
//
// PUBLIC, no login — this is the in-store kiosk: a customer standing in the
// shop, at a store computer, searches inventory themselves and submits a
// pickup list while staff go pull the cards. No account needed, just a name.
//
// Trust boundary, same shape as /api/sell/submit: validate + rate-limit here,
// then call the SECURITY DEFINER RPC with the service_role key. The RPC does
// the real work (row-locked stock check + reservation + pickup request),
// atomically, so two kiosk submissions racing for the last copy of a card
// can't both succeed. kiosk_create_pickup_request's EXECUTE grant is
// restricted to service_role — it cannot be called directly from a browser.

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_PER_WINDOW = 8;
const RATE_WINDOW_MS = 10 * 60_000;
const MAX_ITEMS = 20;

interface KioskItemInput {
  inventoryItemId?: unknown;
  quantity?: unknown;
}

interface SubmitBody {
  hp_ref?: unknown;
  website?: unknown;
  customerName?: unknown;
  phone?: unknown;
  email?: unknown;
  items?: KioskItemInput[];
}

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit("kiosk-submit", ip, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new HttpError(429, "Too many requests. Please wait a moment and try again.");
    }

    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as SubmitBody;

    // Honeypot, same pattern as /api/subscribe and /api/sell/submit.
    const honeypot = cleanString(body.hp_ref ?? body.website, 200);
    if (honeypot) {
      return sendJson(res, 200, { ok: true, requestId: "00000000-0000-0000-0000-000000000000" });
    }

    const customerName = cleanString(body.customerName, 100);
    if (!customerName) {
      throw new HttpError(400, "Please tell us your name so staff can find you.");
    }
    const phone = cleanString(body.phone, 30);
    // Optional and best-effort: an unparseable email is just dropped rather
    // than blocking the submission — phone is the required contact method.
    const email = normalizeEmail(body.email);

    const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    if (rawItems.length === 0) {
      throw new HttpError(400, "Add at least one card to your pickup list.");
    }
    const items = rawItems.map((raw) => {
      const inventoryItemId = cleanString(raw.inventoryItemId, 64);
      const quantity = Math.floor(Number(raw.quantity));
      if (!inventoryItemId || !Number.isFinite(quantity) || quantity < 1 || quantity > 20) {
        throw new HttpError(400, "One of the items in your list isn't valid.");
      }
      return { inventory_item_id: inventoryItemId, quantity };
    });

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("kiosk_create_pickup_request", {
      p_customer_name: customerName,
      p_phone: phone ?? "",
      p_items: items,
      p_email: email ?? undefined,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("insufficient stock") || msg.includes("no longer available")) {
        throw new HttpError(
          409,
          "One of the cards you picked just became unavailable. Please review your list and try again.",
        );
      }
      console.error("[/api/kiosk/submit] rpc failed:", error);
      throw new HttpError(500, "We couldn't save your pickup list. Please ask staff for help.");
    }

    return sendJson(res, 200, { ok: true, requestId: data as string });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/kiosk/submit] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
