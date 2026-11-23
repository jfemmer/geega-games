import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import {
  MAX_ORDER_LINES_CEILING,
  MIN_ORDER_LINES,
  isValidOrderLineLimit,
} from "../../src/store/lib/orderLimits.js";

// GET/PUT /api/admin/checkout-settings — the admin Checkout Settings page.
//
//   GET                       -> { settings, carts }
//   PUT { maxOrderLines }     -> { settings, carts }
//
// maxOrderLines is the most different cards one online order may have
// (store_settings.max_order_lines). checkout_place_order_core enforces it and
// the storefront reads it through store_ordering_status(); see
// supabase/migrations/20261123210000_max_order_lines_setting.sql.
//
// `carts` sizes up signed-in customers' carts against the limit, so staff can
// see whether anyone is stuck over it right now. Guests' carts live in their
// browsers and aren't counted.

export type CheckoutSettingsResponse = {
  settings: { maxOrderLines: number; updatedAt: string };
  carts: { largestLines: number; overLimit: number } | null;
};

type SettingsRow = { max_order_lines: number; updated_at: string };

async function cartSummary(
  admin: ReturnType<typeof getSupabaseAdmin>,
  limit: number,
): Promise<CheckoutSettingsResponse["carts"]> {
  // Extra: the page still works if this can't be read.
  const { data, error } = await admin.rpc("admin_cart_size_summary", { p_limit: limit });
  if (error) {
    console.warn("[checkout-settings] cart summary failed", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { largest_lines: number; carts_over_limit: number } | null;
  return row ? { largestLines: row.largest_lines, overLimit: row.carts_over_limit } : null;
}

async function respond(res: VercelResponse, admin: ReturnType<typeof getSupabaseAdmin>, row: SettingsRow) {
  const body: CheckoutSettingsResponse = {
    settings: { maxOrderLines: row.max_order_lines, updatedAt: row.updated_at },
    carts: await cartSummary(admin, row.max_order_lines),
  };
  return sendJson(res, 200, body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!["GET", "PUT"].includes(req.method ?? "")) {
    return methodNotAllowed(res, ["GET", "PUT"]);
  }

  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    const { data: current, error: loadError } = await admin
      .from("store_settings")
      .select("max_order_lines, updated_at")
      .eq("id", true)
      .single();
    if (loadError || !current) throw new HttpError(500, "Could not load checkout settings.");

    if (req.method === "GET") return respond(res, admin, current);

    const body = (await readJsonBody(req)) as { maxOrderLines?: unknown };
    if (!isValidOrderLineLimit(body.maxOrderLines)) {
      throw new HttpError(
        400,
        `Enter a whole number from ${MIN_ORDER_LINES} to ${MAX_ORDER_LINES_CEILING.toLocaleString("en-US")}.`,
      );
    }

    const { data: updated, error } = await admin
      .from("store_settings")
      .update({
        max_order_lines: body.maxOrderLines,
        updated_at: new Date().toISOString(),
        updated_by: staff.userId,
      })
      .eq("id", true)
      .select("max_order_lines, updated_at")
      .single();
    if (error || !updated) throw new HttpError(500, "Could not save checkout settings.");

    if (updated.max_order_lines !== current.max_order_lines) {
      await logAdminAction(admin, staff, {
        action: "store.max_order_lines_changed",
        resourceType: "store_settings",
        resourceId: "store",
        before: { max_order_lines: current.max_order_lines },
        after: { max_order_lines: updated.max_order_lines },
      });
    }

    return respond(res, admin, updated);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
