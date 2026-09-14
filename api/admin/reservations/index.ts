import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";

// /api/admin/reservations
//
//   GET  -> all ACTIVE reservations, joined to customer + card fields, ready to
//           group by customer in the Reserved tab.
//   POST -> atomically create a reservation. The admin_create_reservation RPC
//           locks the inventory row and REJECTS overbooking, so availability is
//           enforced in the database, never in the browser.
//
// Both branches verify staff first. The SECURITY DEFINER RPCs re-check.

interface CreateBody {
  inventoryItemId?: string;
  customerId?: string;
  quantity?: number;
  note?: string | null;
  reservedBy?: string | null;
}

function actorLabel(staff: StaffContext, bodyActor?: string | null): string {
  return (bodyActor && bodyActor.trim()) || staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await admin.rpc("admin_list_reservations");
      if (error) throw new HttpError(500, error.message);
      return sendJson(res, 200, { ok: true, rows: (data ?? []) as unknown[] });
    }

    if (req.method === "POST") {
      const body = (await readJsonBody(req)) as CreateBody;
      const inventoryItemId = String(body.inventoryItemId ?? "");
      const customerId = String(body.customerId ?? "");
      const quantity = Math.floor(Number(body.quantity));

      if (!inventoryItemId) {
        throw new HttpError(400, "inventoryItemId is required.");
      }
      if (!customerId) {
        throw new HttpError(400, "customerId is required.");
      }
      if (!Number.isFinite(quantity) || quantity < 1) {
        throw new HttpError(400, "quantity must be a whole number of at least 1.");
      }

      const { data, error } = await admin.rpc("admin_create_reservation", {
        p_inventory_item_id: inventoryItemId,
        p_customer_id: customerId,
        p_quantity: quantity,
        p_note: body.note ?? undefined,
        p_reserved_by: actorLabel(staff, body.reservedBy),
      });
      if (error) {
        // 23514 is our overbooking check-violation → surface as a 409 with the
        // friendly "Only N available" message the RPC raised.
        const overbook =
          typeof error.message === "string" &&
          /available to reserve/i.test(error.message);
        throw new HttpError(overbook ? 409 : 500, error.message);
      }

      return sendJson(res, 201, {
        ok: true,
        reservation: data as unknown as Record<string, unknown>,
      });
    }

    return methodNotAllowed(res, ["GET", "POST"]);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}