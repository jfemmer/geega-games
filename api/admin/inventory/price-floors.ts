import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";

// GET/PUT /api/admin/inventory/price-floors
//
// Staff-only. inventory_price_floors has no write grant to `authenticated`
// (see its migration), so every change goes through here with the
// service-role key, same as the rest of /api/admin/inventory/*.
//
// GET returns the 4 rows (one per rarity). PUT replaces all 4 minimums in
// one call — the UI always edits the full set together, so there's no
// partial-update case to support.

const RARITIES = ["common", "uncommon", "rare", "mythic"] as const;

interface PutBody {
  common?: unknown;
  uncommon?: unknown;
  rare?: unknown;
  mythic?: unknown;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "PUT") {
    return methodNotAllowed(res, ["GET", "PUT"]);
  }
  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("inventory_price_floors")
        .select("rarity, min_price_cents, updated_at, updated_by")
        .order("rarity");
      if (error) throw new HttpError(500, error.message);
      return sendJson(res, 200, { ok: true, floors: data ?? [] });
    }

    // PUT
    const body = (await readJsonBody(req, 4 * 1024)) as PutBody;
    for (const rarity of RARITIES) {
      if (!isNonNegativeInt(body[rarity])) {
        throw new HttpError(400, `${rarity} must be a whole number of cents, 0 or more.`);
      }
    }

    const now = new Date().toISOString();
    const rows = RARITIES.map((rarity) => ({
      rarity,
      min_price_cents: body[rarity] as number,
      updated_at: now,
      updated_by: staff.email,
    }));

    const { data, error } = await admin
      .from("inventory_price_floors")
      .upsert(rows, { onConflict: "rarity" })
      .select("rarity, min_price_cents, updated_at, updated_by")
      .order("rarity");
    if (error) throw new HttpError(500, error.message);

    return sendJson(res, 200, { ok: true, floors: data ?? [] });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
