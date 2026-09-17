import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import {
  requireStaff,
  requireCapability,
  type StaffContext,
} from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";

// PATCH /api/admin/inventory/bulk — safe bulk field edits across itemIds.
//
// Mirrors the shape already proven by api/admin/scans/bulk.ts: an array of
// ids plus a narrow, server-enforced set of editable fields — never a raw
// patch object trusted from the client. Each field is independent and
// optional; only the ones present are applied.
//
// Status changes go through admin_set_inventory_status per item (same RPC
// a single-item archive uses) so a bulk archive writes the SAME movement
// history a manual one does. A percentage price adjustment is computed
// per-row in application code (each row's current price differs) and
// applied with individual updates — bulk selections are page-sized, not a
// hot path, so this is a non-issue in practice. A fixed price or a storage
// location, being the SAME value for every row, are each a single query.

interface Body {
  itemIds?: string[];
  status?: "active" | "archived";
  priceCents?: number;
  priceAdjustPercent?: number;
  storageLocation?: string | null;
  actor?: string | null;
}

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    const staff = await requireStaff(req);
    requireCapability(staff, "inventory.write");
    const body = (await readJsonBody(req)) as Body;
    const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter(Boolean) : [];
    if (itemIds.length === 0) throw new HttpError(400, "No inventory items selected.");
    if (itemIds.length > 500) {
      throw new HttpError(400, "Select 500 or fewer items at a time.");
    }
    if (body.priceCents !== undefined && body.priceAdjustPercent !== undefined) {
      throw new HttpError(400, "Set a fixed price OR a percentage adjustment, not both.");
    }

    const admin = getSupabaseAdmin();
    const actor = actorLabel(staff, body.actor);
    let updatedCount = 0;

    if (body.status !== undefined) {
      for (const id of itemIds) {
        const { error } = await admin.rpc("admin_set_inventory_status", {
          p_id: id,
          p_status: body.status,
          p_actor: actor,
        });
        if (error) {
          throw new HttpError(500, `Could not update status for one or more items: ${error.message}`);
        }
      }
      updatedCount = itemIds.length;
    }

    if (body.storageLocation !== undefined) {
      const { error } = await admin
        .from("inventory_items")
        .update({ storage_location: body.storageLocation })
        .in("id", itemIds);
      if (error) throw new HttpError(500, error.message);
      updatedCount = Math.max(updatedCount, itemIds.length);
    }

    if (body.priceCents !== undefined) {
      const priceCents = Math.max(0, Math.round(body.priceCents));
      const { error } = await admin
        .from("inventory_items")
        .update({ price_cents: priceCents })
        .in("id", itemIds);
      if (error) throw new HttpError(500, error.message);
      updatedCount = Math.max(updatedCount, itemIds.length);
    } else if (body.priceAdjustPercent !== undefined) {
      const percent = Number(body.priceAdjustPercent);
      if (!Number.isFinite(percent) || percent <= -100) {
        throw new HttpError(400, "priceAdjustPercent must be a number greater than -100.");
      }
      const { data: rows, error: readErr } = await admin
        .from("inventory_items")
        .select("id, price_cents")
        .in("id", itemIds);
      if (readErr) throw new HttpError(500, readErr.message);
      for (const row of rows ?? []) {
        if (row.price_cents == null) continue; // nothing to adjust a percentage of
        const nextPrice = Math.max(0, Math.round(row.price_cents * (1 + percent / 100)));
        const { error } = await admin
          .from("inventory_items")
          .update({ price_cents: nextPrice })
          .eq("id", row.id);
        if (error) throw new HttpError(500, error.message);
      }
      updatedCount = Math.max(updatedCount, (rows ?? []).length);
    }

    if (updatedCount === 0) {
      throw new HttpError(400, "No changes were specified.");
    }

    await logAdminAction(admin, staff, {
      action: "inventory.bulk_update",
      resourceType: "inventory_item",
      resourceId: `${itemIds.length} items`,
      after: {
        itemIds,
        status: body.status,
        priceCents: body.priceCents,
        priceAdjustPercent: body.priceAdjustPercent,
        storageLocation: body.storageLocation,
      },
    });

    return sendJson(res, 200, { ok: true, updatedCount });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
