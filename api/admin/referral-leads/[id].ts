import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { isReferralLeadStatus } from "../../../src/store/lib/referralTypes.js";

// PATCH /api/admin/referral-leads/:id  { status }
//
// Staff-only. Moves a Pokémon / One Piece / video game referral lead through
// New → Sent to partner → Closed on the admin Partner Leads page. Like
// sell_submissions, referral_leads has no write grant for `authenticated`
// at all (see the referral_leads migration), so this service_role endpoint
// is the only way to change a lead, and it only ever touches `status`.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Lead id is required.");

    const body = (await readJsonBody(req, 1024)) as { status?: unknown };
    if (!isReferralLeadStatus(body.status)) throw new HttpError(400, "Invalid status.");

    const { data, error } = await getSupabaseAdmin()
      .from("referral_leads")
      .update({ status: body.status })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Lead not found.");

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
