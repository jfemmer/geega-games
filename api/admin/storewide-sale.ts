import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";

interface SaleBody {
  name?: string;
  discountPercent?: number;
  startsAt?: string;
  endsAt?: string;
}

function parseDate(value: string | undefined, label: string): string {
  if (!value) throw new HttpError(400, `${label} is required.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return date.toISOString();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!["GET", "PUT", "DELETE"].includes(req.method ?? "")) {
    return methodNotAllowed(res, ["GET", "PUT", "DELETE"]);
  }

  try {
    const staff = await requireStaff(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("storewide_sales")
        .select("id, name, discount_percent, starts_at, ends_at, enabled, created_at, updated_at")
        .eq("enabled", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new HttpError(500, "Could not load the storewide sale.");
      return sendJson(res, 200, { sale: data ?? null });
    }

    if (req.method === "DELETE") {
      const { error } = await admin
        .from("storewide_sales")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("enabled", true);
      if (error) throw new HttpError(500, "Could not stop the storewide sale.");
      return sendJson(res, 200, { ok: true });
    }

    const body = (await readJsonBody(req)) as SaleBody;
    const discountPercent = Math.round(Number(body.discountPercent));
    if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 90) {
      throw new HttpError(400, "Discount must be between 1% and 90%.");
    }

    const startsAt = parseDate(body.startsAt, "Start time");
    const endsAt = parseDate(body.endsAt, "End time");
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new HttpError(400, "End time must be after the start time.");
    }

    const name = body.name?.trim() || "Storewide Sale";

    // Only one sale may be enabled at a time. Replacing a scheduled/active sale
    // is intentional and keeps storefront pricing unambiguous.
    const { error: disableError } = await admin
      .from("storewide_sales")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("enabled", true);
    if (disableError) throw new HttpError(500, "Could not replace the existing sale.");

    const { data, error } = await admin
      .from("storewide_sales")
      .insert({
        name,
        discount_percent: discountPercent,
        starts_at: startsAt,
        ends_at: endsAt,
        enabled: true,
        created_by: staff.userId,
      })
      .select("id, name, discount_percent, starts_at, ends_at, enabled, created_at, updated_at")
      .single();
    if (error) throw new HttpError(500, "Could not save the storewide sale.");

    return sendJson(res, 200, { sale: data });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
