import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import type { InventoryRow } from "../../_lib/inventory.js";
import type { Database } from "../../../src/types/database.js";

// PATCH /api/admin/inventory/:id
//
// Update editable fields of an inventory line (price, cost, reference price,
// storage location, SKU, notes, image, listing status). Quantity is NOT changed
// here — quantity always flows through /adjust so it is recorded in the movement
// ledger. A status change to/from 'archived' is routed through the
// admin_set_inventory_status RPC so it also writes a movement row; other field
// edits are a direct staff-guarded update.

interface Body {
  priceCents?: number | null;
  costCents?: number | null;
  scryfallPriceCents?: number | null;
  storageLocation?: string | null;
  sku?: string | null;
  notes?: string | null;
  status?: InventoryRow["status"];
  imageUrl?: string | null;
}

const STATUSES = new Set(["active", "reserved", "archived"]);

function actorLabel(staff: StaffContext): string {
  return staff.email || staff.userId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    const staff = await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Inventory id is required.");

    const body = (await readJsonBody(req)) as Body;
    const admin = getSupabaseAdmin();

    // Route a status change through the RPC so it lands in the ledger too.
    if (body.status !== undefined) {
      if (!STATUSES.has(body.status)) {
        throw new HttpError(400, "Invalid status.");
      }
      const { error } = await admin.rpc("admin_set_inventory_status", {
        p_id: id,
        p_status: body.status,
        p_actor: actorLabel(staff),
      });
      if (error) throw new HttpError(500, error.message);
    }

    // Direct field edits (never quantity). Only include provided keys.
    const patch: Database["public"]["Tables"]["inventory_items"]["Update"] = {};
    if (body.priceCents !== undefined)
      patch.price_cents =
        body.priceCents == null ? null : Math.max(0, Math.round(body.priceCents));
    if (body.costCents !== undefined)
      patch.cost_cents =
        body.costCents == null ? null : Math.max(0, Math.round(body.costCents));
    if (body.scryfallPriceCents !== undefined)
      patch.scryfall_price_cents =
        body.scryfallPriceCents == null
          ? null
          : Math.max(0, Math.round(body.scryfallPriceCents));
    if (body.storageLocation !== undefined)
      patch.storage_location = body.storageLocation;
    if (body.sku !== undefined) patch.sku = body.sku;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.imageUrl !== undefined) patch.image_url = body.imageUrl;

    if (Object.keys(patch).length > 0) {
      const { error } = await admin
        .from("inventory_items")
        .update(patch)
        .eq("id", id);
      if (error) throw new HttpError(500, error.message);
    }

    // Return the fresh row.
    const { data, error: readErr } = await admin
      .from("inventory_items")
      .select("*")
      .eq("id", id)
      .single();
    if (readErr) throw new HttpError(404, "Inventory item not found.");
    return sendJson(res, 200, data as unknown as Record<string, unknown>);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}