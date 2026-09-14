import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, sendJson } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import type { Database } from "../../../src/types/database.js";

// GET /api/admin/campaigns/audience-count?audience=active_subscribers
//
// Returns the LIVE recipient count for an audience (real newsletter/customer
// rows — never a hardcoded figure). Used by the campaign editor to show an
// accurate "N recipients" as the audience selection changes.

type Audience = Database["public"]["Enums"]["campaign_audience"];

const AUDIENCES = new Set<Audience>([
  "active_subscribers",
  "confirmed_recent",
  "all_customers",
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    await requireStaff(req);
    const audience = String(req.query.audience ?? "") as Audience;
    if (!AUDIENCES.has(audience)) {
      throw new HttpError(400, "A valid audience is required.");
    }
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("campaign_audience_count", {
      p_audience: audience,
    });
    if (error) throw new HttpError(500, error.message);
    return sendJson(res, 200, { ok: true, count: Number(data ?? 0) });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message =
      err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}