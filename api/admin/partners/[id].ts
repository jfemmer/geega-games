import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff, type StaffContext } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import { sendPartnerApprovedEmail } from "../../_lib/partnerEmails.js";
import {
  ensurePartnerReferralCode,
  partnerFieldsFromInput,
  type PartnerFieldsInput,
  type PartnerUpdate,
} from "../../_lib/partners.js";
import type { PartnerKind, PartnerStatus } from "../../../src/store/lib/partnerTypes.js";

// PATCH /api/admin/partners/:id  { action, fields?, sendWelcome? }
//
//   approve   applied/paused/declined → active. A referral partner gets its
//             personal referral code. The welcome email goes out the first
//             time (sendWelcome defaults to true when approving an application).
//   decline   → declined (no email; reply to their application email if you
//             want to explain).
//   pause     active → paused: no new leads go to them, their link stops
//             crediting new sellers.
//   activate  paused → active.
//   update    edit fields: contact details, what they buy, where, fee %…
//
// DELETE /api/admin/partners/:id — only for a partner with no fee records (no
// lead ever sent to them, no referral fee earned). Removes their referral code
// too.
//
// Owner-only (app role "admin"): partners and their fees are business terms.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["approve", "decline", "pause", "activate", "update"]);

interface Body {
  action?: unknown;
  fields?: PartnerFieldsInput;
  sendWelcome?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH" && req.method !== "DELETE") return methodNotAllowed(res, ["PATCH", "DELETE"]);
  try {
    const staff = await requireStaff(req);
    if (staff.role !== "admin") throw new HttpError(403, "Only the store owner can change partners.");
    const id = String(req.query.id ?? "");
    if (!UUID_RE.test(id)) throw new HttpError(400, "Partner id is required.");

    const admin = getSupabaseAdmin();
    const { data: partner, error: readErr } = await admin
      .from("partners")
      .select("id, kind, status, business_name, fee_percent, approved_at")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, readErr.message);
    if (!partner) throw new HttpError(404, "Partner not found.");

    if (req.method === "DELETE") return await deletePartner(res, staff, partner);

    const body = (await readJsonBody(req, 16 * 1024)) as Body;
    const action = typeof body.action === "string" && ACTIONS.has(body.action) ? body.action : null;
    if (!action) throw new HttpError(400, "Invalid action.");

    const kind = partner.kind as PartnerKind;
    const current = partner.status as PartnerStatus;
    let update: PartnerUpdate = {};
    let sendWelcome = false;

    switch (action) {
      case "approve":
        if (current === "active") throw new HttpError(409, "This partner is already active.");
        update = { status: "active", approved_at: partner.approved_at ?? new Date().toISOString() };
        sendWelcome = body.sendWelcome === undefined ? current === "applied" : body.sendWelcome === true;
        break;
      case "decline":
        if (current === "declined") throw new HttpError(409, "Already declined.");
        update = { status: "declined" };
        break;
      case "pause":
        if (current !== "active") throw new HttpError(409, "Only an active partner can be paused.");
        update = { status: "paused" };
        break;
      case "activate":
        if (current !== "paused") throw new HttpError(409, "Only a paused partner can be reactivated.");
        update = { status: "active" };
        break;
      case "update":
        update = partnerFieldsFromInput(body.fields ?? {}, kind);
        if (Object.keys(update).length === 0) throw new HttpError(400, "Nothing to change.");
        break;
    }

    const { error: updateErr } = await admin.from("partners").update(update).eq("id", id);
    if (updateErr) throw new HttpError(500, updateErr.message);

    let referralCode: string | null = null;
    if (kind === "referrer" && (action === "approve" || action === "activate")) {
      referralCode = await ensurePartnerReferralCode(admin, id);
    }

    let welcome: string | null = null;
    if (sendWelcome) welcome = (await sendPartnerApprovedEmail(id)).status;

    await logAdminAction(admin, staff, {
      action: `partner.${action}`,
      resourceType: "partner",
      resourceId: id,
      before: { status: current, fee_percent: partner.fee_percent },
      after: update as Record<string, unknown>,
    });

    return sendJson(res, 200, { ok: true, referralCode, welcome });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/admin/partners/:id] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}

async function deletePartner(
  res: VercelResponse,
  staff: StaffContext,
  partner: { id: string; kind: string; status: string; business_name: string },
) {
  const admin = getSupabaseAdmin();
  // Fee records must keep saying who they're with: leads sent to a store, and
  // referral fees earned by a referral partner (both restrict the delete in
  // the database too; these give a clear message first).
  const [referrals, rewards] = await Promise.all([
    admin.from("partner_referrals").select("id", { count: "exact", head: true }).eq("partner_id", partner.id),
    admin.from("referral_rewards").select("id", { count: "exact", head: true }).eq("partner_id", partner.id),
  ]);
  const countErr = referrals.error ?? rewards.error;
  if (countErr) throw new HttpError(500, countErr.message);
  if ((referrals.count ?? 0) > 0) {
    throw new HttpError(409, "Leads were sent to this partner, so it's kept for the fee records. Pause it instead.");
  }
  if ((rewards.count ?? 0) > 0) {
    throw new HttpError(409, "This partner has earned referral fees, so it's kept for the records. Pause it instead.");
  }

  const { error } = await admin.from("partners").delete().eq("id", partner.id);
  if (error) throw new HttpError(500, "Could not delete the partner.");

  await logAdminAction(admin, staff, {
    action: "partner.delete",
    resourceType: "partner",
    resourceId: partner.id,
    before: { kind: partner.kind, status: partner.status, business_name: partner.business_name },
    after: null,
  });
  res.status(204).end();
}
