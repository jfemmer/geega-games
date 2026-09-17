import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../../_lib/http.js";
import {
  requireStaff,
  requireCapability,
  type StaffContext,
} from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../../_lib/auditLog.js";

// POST /api/admin/inventory/:id/archive
//
// Archive (default) or restore a line via admin_set_inventory_status, which also
// writes a movement row. Archived rows disappear from the storefront
// (inventory_public filters status='active') without losing quantity/history.
// Body (optional): { restore?: boolean }.

interface Body {
  restore?: boolean;
}

function actorLabel(staff: StaffContext): string {
  return staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    requireCapability(staff, "inventory.write");
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Inventory id is required.");

    const body = (await readJsonBody(req).catch(() => ({}))) as Body;
    const nextStatus = body.restore === true ? "active" : "archived";

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("admin_set_inventory_status", {
      p_id: id,
      p_status: nextStatus,
      p_actor: actorLabel(staff),
    });
    if (error) throw new HttpError(500, error.message);
    await logAdminAction(admin, staff, {
      action: nextStatus === "archived" ? "inventory.archive" : "inventory.restore",
      resourceType: "inventory_item",
      resourceId: id,
    });
    return sendJson(res, 200, data as unknown as Record<string, unknown>);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}