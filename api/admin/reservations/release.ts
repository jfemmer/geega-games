import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";

// POST /api/admin/reservations/release
//
// Two modes, both atomic and staff-guarded:
//   1. { reservationId, quantity? } — release one reservation, fully or a
//      specific quantity (partial releases record a released row for history).
//   2. { customerId, inventoryItemId? } — release ALL active reservations for a
//      customer, optionally scoped to one inventory line.
//
// Released copies immediately return to the storefront (inventory_public reads
// only ACTIVE reservations).

interface Body {
  reservationId?: string;
  quantity?: number | null;
  customerId?: string;
  inventoryItemId?: string | null;
  releasedBy?: string | null;
}

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    const body = (await readJsonBody(req)) as Body;
    const admin = getSupabaseAdmin();
    const releasedBy = actorLabel(staff, body.releasedBy);

    if (body.reservationId) {
      const qtyRaw = body.quantity;
      const quantity =
        qtyRaw == null ? undefined : Math.max(1, Math.floor(Number(qtyRaw)));
      const { data, error } = await admin.rpc("admin_release_reservation", {
        p_reservation_id: String(body.reservationId),
        p_quantity: quantity,
        p_released_by: releasedBy,
      });
      if (error) throw new HttpError(500, error.message);
      return sendJson(res, 200, {
        ok: true,
        reservation: data as unknown as Record<string, unknown>,
      });
    }

    if (body.customerId) {
      const { data, error } = await admin.rpc(
        "admin_release_customer_reservations",
        {
          p_customer_id: String(body.customerId),
          p_inventory_item_id: body.inventoryItemId ?? undefined,
          p_released_by: releasedBy,
        },
      );
      if (error) throw new HttpError(500, error.message);
      return sendJson(res, 200, { ok: true, releasedCount: Number(data ?? 0) });
    }

    throw new HttpError(
      400,
      "Provide either reservationId or customerId to release.",
    );
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}