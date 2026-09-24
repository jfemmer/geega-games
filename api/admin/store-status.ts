import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";

// GET/PUT /api/admin/store-status — vacation mode.
//
// Pausing online ordering is enforced by checkout_create_order in the DB
// (migration 20260924060000); this endpoint only edits the single
// store_settings row. The storefront reads it through the public
// store_ordering_status() RPC.

const MAX_MESSAGE = 500;

type StatusBody = {
  ordersPaused?: unknown;
  message?: unknown;
  pausedUntil?: unknown;
};

const COLUMNS = "orders_paused, orders_paused_message, orders_paused_until, updated_at";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!["GET", "PUT"].includes(req.method ?? "")) {
    return methodNotAllowed(res, ["GET", "PUT"]);
  }

  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    const { data: current, error: loadError } = await admin
      .from("store_settings")
      .select(COLUMNS)
      .eq("id", true)
      .single();
    if (loadError || !current) throw new HttpError(500, "Could not load store settings.");

    if (req.method === "GET") {
      return sendJson(res, 200, { status: current });
    }

    const body = (await readJsonBody(req)) as StatusBody;

    if (typeof body.ordersPaused !== "boolean") {
      throw new HttpError(400, "ordersPaused must be true or false.");
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new HttpError(400, "Please enter a message for customers.");
    if (message.length > MAX_MESSAGE) {
      throw new HttpError(400, `Keep the message under ${MAX_MESSAGE} characters.`);
    }

    let pausedUntil: string | null = null;
    if (body.pausedUntil !== null && body.pausedUntil !== undefined && body.pausedUntil !== "") {
      const d = new Date(String(body.pausedUntil));
      if (Number.isNaN(d.getTime())) throw new HttpError(400, "The reopen date is invalid.");
      if (body.ordersPaused && d.getTime() <= Date.now()) {
        throw new HttpError(400, "The reopen date must be in the future.");
      }
      pausedUntil = d.toISOString();
    }

    const { data: updated, error } = await admin
      .from("store_settings")
      .update({
        orders_paused: body.ordersPaused,
        orders_paused_message: message,
        // A reopen date only means something while paused.
        orders_paused_until: body.ordersPaused ? pausedUntil : null,
        updated_at: new Date().toISOString(),
        updated_by: staff.userId,
      })
      .eq("id", true)
      .select(COLUMNS)
      .single();
    if (error || !updated) throw new HttpError(500, "Could not save store settings.");

    await logAdminAction(admin, staff, {
      action: updated.orders_paused ? "store.orders_paused" : "store.orders_resumed",
      resourceType: "store_settings",
      resourceId: "store",
      before: current,
      after: updated,
    });

    return sendJson(res, 200, { status: updated });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
