import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import type { Database } from "../../../../src/types/database.js";

// POST /api/admin/inventory/:id/adjust
//
// Atomically change a line's quantity by a signed delta and record the movement
// in ONE transaction (admin_adjust_inventory_quantity). Quantity is clamped at
// zero server-side (never negative). Body: { delta, reason, actor?, note? }.

interface Body {
  delta?: number;
  reason?: string;
  note?: string | null;
  actor?: string | null;
}

const REASONS = new Set([
  "manual_add",
  "manual_remove",
  "correction",
  "scan_add",
  "batch_scan_add",
  "order_reserved",
  "order_shipped",
  "order_cancelled",
  "import",
  "archive",
  "restore",
]);

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Inventory id is required.");

    const body = (await readJsonBody(req)) as Body;
    const delta = Math.trunc(Number(body.delta));
    if (!Number.isFinite(delta) || delta === 0) {
      throw new HttpError(400, "A non-zero integer delta is required.");
    }
    const reason = String(body.reason ?? "correction");
    if (!REASONS.has(reason)) {
      throw new HttpError(400, "Invalid movement reason.");
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("admin_adjust_inventory_quantity", {
      p_id: id,
      p_delta: delta,
      p_reason: reason as Database["public"]["Enums"]["inventory_movement_reason"],
      p_actor: actorLabel(staff, body.actor),
      p_note: body.note ?? undefined,
    });
    if (error) throw new HttpError(500, error.message);
    return sendJson(res, 200, data as unknown as Record<string, unknown>);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}