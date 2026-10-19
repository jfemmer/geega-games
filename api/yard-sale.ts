import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "./_lib/http.js";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { checkRateLimit, getClientIp } from "./_lib/rateLimit.js";
import {
  UUID_RE,
  YardSaleError,
  loadYardSaleListView,
  notifyYardSaleList,
  verifyYardSaleListToken,
  yardSaleDbError,
  yardSaleListToken,
} from "./_lib/yardSale.js";
import { YARD_SALE_LIMITS } from "../src/store/lib/yardSale.js";

// POST /api/yard-sale — the /yard-sale page on a shopper's phone. Public, no
// login (like the kiosk and /api/sell/submit): validate and rate-limit here,
// then call the SECURITY DEFINER functions with the service role key. They
// do the real work (row-locked stock checks, holds, pickup numbers), so two
// shoppers racing for the last copy can't both get it.
//
//   { action: "submit", name, items: [{ inventoryItemId, quantity }], website }
//        -> { list, token }   a new list with the sale's next pickup number
//   { action: "add", requestId, token, items }   -> { list }   more cards
//   { action: "get", requestId, token }          -> { list }   show it again
//
// The token (an HMAC of the list id) comes back once with the new list and
// is what lets that phone see and add to it. Nobody pays here: the shopper
// pays staff in person and staff complete the list in the admin.

const MAX_BODY_BYTES = 8 * 1024;
const WINDOW_MS = 10 * 60_000;
// Generous: shoppers on the yard sale's Wi-Fi share one address.
const LIMITS = { submit: 20, add: 60, get: 120 } as const;

type Action = keyof typeof LIMITS;

interface Body {
  action?: unknown;
  name?: unknown;
  items?: unknown;
  requestId?: unknown;
  token?: unknown;
  website?: unknown;
  hp_ref?: unknown;
}

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

/** The cards from the phone, checked for shape (the database checks stock and prices). */
function parseItems(raw: unknown): { inventory_item_id: string; quantity: number }[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new YardSaleError(400, "Add at least one card to your list.", "invalid");
  }
  if (raw.length > YARD_SALE_LIMITS.linesPerSend) {
    throw new YardSaleError(400, "That's more cards than we can take at once. Send these in two goes.", "invalid");
  }
  const merged = new Map<string, number>();
  for (const entry of raw) {
    const item = (entry ?? {}) as { inventoryItemId?: unknown; quantity?: unknown };
    const id = typeof item.inventoryItemId === "string" ? item.inventoryItemId.trim().toLowerCase() : "";
    const quantity = typeof item.quantity === "number" ? item.quantity : Number.NaN;
    if (!UUID_RE.test(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > YARD_SALE_LIMITS.copiesPerCard) {
      throw new YardSaleError(400, "Something in your list didn't look right. Please try again.", "invalid");
    }
    merged.set(id, (merged.get(id) ?? 0) + quantity);
  }
  return [...merged].map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
}

function listAccess(body: Body): string {
  const requestId = typeof body.requestId === "string" ? body.requestId.trim().toLowerCase() : "";
  if (!UUID_RE.test(requestId) || !verifyYardSaleListToken(requestId, body.token)) {
    throw new YardSaleError(404, "We couldn't find your list. Start a new one.", "not_found");
  }
  return requestId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Body;
    const action = body.action;
    if (action !== "submit" && action !== "add" && action !== "get") {
      throw new YardSaleError(400, "Unknown action.", "invalid");
    }

    const rl = checkRateLimit(`yard-sale-${action}`, getClientIp(req), LIMITS[action as Action], WINDOW_MS);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)));
      throw new YardSaleError(429, "Too many tries. Please wait a moment and try again.", "invalid");
    }

    const admin = getSupabaseAdmin();

    if (action === "submit") {
      // Honeypot: a bot gets a convincing answer and nothing is held.
      if (cleanString(body.website ?? body.hp_ref, 200)) {
        return sendJson(res, 200, { ok: true });
      }
      const name = cleanString(body.name, 200);
      if (!name || name.length > YARD_SALE_LIMITS.nameMax) {
        throw new YardSaleError(400, `Please tell us your name (up to ${YARD_SALE_LIMITS.nameMax} characters).`, "invalid");
      }
      const items = parseItems(body.items);
      const { data, error } = await admin.rpc("yard_sale_create_list", { p_customer_name: name, p_items: items });
      if (error) throw yardSaleDbError(error, "We couldn't save your list. Please try again or ask us for help.");
      const row = (Array.isArray(data) ? data[0] : data) as { request_id?: string } | null;
      if (!row?.request_id) throw new YardSaleError(500, "We couldn't save your list. Please ask us for help.", "server");

      const list = await loadYardSaleListView(row.request_id);
      if (!list) throw new YardSaleError(500, "We couldn't save your list. Please ask us for help.", "server");
      await notifyYardSaleList(list, { kind: "new" });
      return sendJson(res, 201, { ok: true, list, token: yardSaleListToken(list.requestId) });
    }

    const requestId = listAccess(body);

    if (action === "add") {
      const items = parseItems(body.items);
      const { error } = await admin.rpc("yard_sale_add_to_list", { p_request_id: requestId, p_items: items });
      if (error) throw yardSaleDbError(error, "We couldn't add those cards. Please try again or ask us for help.");
      const list = await loadYardSaleListView(requestId);
      if (!list) throw new YardSaleError(404, "We couldn't find your list. Start a new one.", "not_found");
      const added = items.reduce((sum, i) => sum + i.quantity, 0);
      await notifyYardSaleList(list, { kind: "added", cards: added, key: randomUUID() });
      return sendJson(res, 200, { ok: true, list });
    }

    const list = await loadYardSaleListView(requestId);
    if (!list) throw new YardSaleError(404, "We couldn't find your list. Start a new one.", "not_found");
    return sendJson(res, 200, { ok: true, list });
  } catch (err) {
    if (err instanceof YardSaleError) {
      if (err.status >= 500) console.error("[/api/yard-sale]", err.message);
      return sendJson(res, err.status, { ok: false, code: err.code, message: err.message });
    }
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { ok: false, code: "invalid", message: err.message });
    }
    console.error("[/api/yard-sale] unexpected error", err);
    return sendJson(res, 500, { ok: false, code: "server", message: "Something went wrong. Please ask us for help." });
  }
}
