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
//
// Raising a floor also repriced EXISTING inventory of that rarity: any
// active/reserved (non-archived) line priced below the new minimum is
// raised to it. This only ever raises a price — a line already at or
// above the floor, or of a different rarity, is untouched, and lowering a
// floor never lowers anyone's price back down. PUT accepts an optional
// `dryRun: true` to preview how many lines would be repriced (per rarity)
// without writing anything, so the UI can confirm before applying.

const RARITIES = ["common", "uncommon", "rare", "mythic"] as const;
type Rarity = (typeof RARITIES)[number];

interface PutBody {
  common?: unknown;
  uncommon?: unknown;
  rare?: unknown;
  mythic?: unknown;
  dryRun?: unknown;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

type RepriceCounts = Record<Rarity, number> & { total: number };

/**
 * For each rarity with a floor above 0, counts (dryRun) or raises (apply)
 * non-archived inventory lines priced below that floor. Returns the
 * per-rarity + total count of lines affected.
 */
async function repriceExistingInventory(
  admin: ReturnType<typeof getSupabaseAdmin>,
  floors: Record<Rarity, number>,
  dryRun: boolean,
): Promise<RepriceCounts> {
  const counts = { common: 0, uncommon: 0, rare: 0, mythic: 0, total: 0 };
  for (const rarity of RARITIES) {
    const floorCents = floors[rarity];
    if (floorCents <= 0) continue;

    if (dryRun) {
      const { count, error } = await admin
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("rarity", rarity)
        .neq("status", "archived")
        .lt("price_cents", floorCents);
      if (error) throw new HttpError(500, error.message);
      counts[rarity] = count ?? 0;
    } else {
      const { data, error } = await admin
        .from("inventory_items")
        .update({ price_cents: floorCents })
        .eq("rarity", rarity)
        .neq("status", "archived")
        .lt("price_cents", floorCents)
        .select("id");
      if (error) throw new HttpError(500, error.message);
      counts[rarity] = data?.length ?? 0;
    }
    counts.total += counts[rarity];
  }
  return counts;
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
    const dryRun = body.dryRun === true;
    const requested: Record<Rarity, number> = {
      common: body.common as number,
      uncommon: body.uncommon as number,
      rare: body.rare as number,
      mythic: body.mythic as number,
    };

    if (dryRun) {
      // Preview only — floors are NOT written. Counts are computed against
      // the requested (not-yet-saved) values.
      const repriced = await repriceExistingInventory(admin, requested, true);
      return sendJson(res, 200, { ok: true, dryRun: true, repriced });
    }

    const now = new Date().toISOString();
    const rows = RARITIES.map((rarity) => ({
      rarity,
      min_price_cents: requested[rarity],
      updated_at: now,
      updated_by: staff.email,
    }));

    const { data, error } = await admin
      .from("inventory_price_floors")
      .upsert(rows, { onConflict: "rarity" })
      .select("rarity, min_price_cents, updated_at, updated_by")
      .order("rarity");
    if (error) throw new HttpError(500, error.message);

    const repriced = await repriceExistingInventory(admin, requested, false);

    return sendJson(res, 200, { ok: true, dryRun: false, floors: data ?? [], repriced });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
