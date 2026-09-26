import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import { forgetLeadNotifications, removeLeadPhotos } from "../../_lib/leadCleanup.js";
import { isReferralLeadStatus } from "../../../src/store/lib/referralTypes.js";

// PATCH /api/admin/referral-leads/:id  { status }
//
// Staff-only. Moves a Pokémon / One Piece / video game referral lead through
// New → Sent to partner → Closed on the admin Partner Leads page. Like
// sell_submissions, referral_leads has no write grant for `authenticated`
// at all (see the referral_leads migration), so this service_role endpoint
// is the only way to change a lead, and it only ever touches `status`.
//
// DELETE /api/admin/referral-leads/:id
//
// Owner-only (app role "admin"). Permanently deletes the lead and the
// seller's photos in Storage. A copy already passed to the buying partner is
// theirs; this only removes ours. Recorded in the audit log without the
// seller's personal details.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH" && req.method !== "DELETE") return methodNotAllowed(res, ["PATCH", "DELETE"]);
  try {
    const staff = await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Lead id is required.");

    if (req.method === "DELETE") {
      if (staff.role !== "admin") throw new HttpError(403, "Only the store owner can delete leads.");
      if (!UUID_RE.test(id)) throw new HttpError(400, "Lead id is required.");
      return await deleteLead(req, res, id, staff);
    }

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

async function deleteLead(
  _req: VercelRequest,
  res: VercelResponse,
  id: string,
  staff: Awaited<ReturnType<typeof requireStaff>>,
) {
  const admin = getSupabaseAdmin();
  const { data: lead, error: readErr } = await admin
    .from("referral_leads")
    .select("id, reference_number, status, categories, created_at, photo_paths")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new HttpError(500, readErr.message);
  if (!lead) throw new HttpError(404, "Lead not found.");

  const { error: deleteErr } = await admin.from("referral_leads").delete().eq("id", id);
  if (deleteErr) throw new HttpError(500, "Could not delete the lead. Please try again.");

  await removeLeadPhotos(lead.photo_paths ?? [], lead.reference_number);
  await forgetLeadNotifications("partner_lead", id);
  await logAdminAction(admin, staff, {
    action: "partner_lead.delete",
    resourceType: "referral_lead",
    resourceId: id,
    before: {
      reference_number: lead.reference_number,
      status: lead.status,
      categories: lead.categories,
      created_at: lead.created_at,
      photo_count: lead.photo_paths?.length ?? 0,
    },
    after: null,
  });

  res.status(204).end();
}
