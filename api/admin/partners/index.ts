import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import { sendPartnerApprovedEmail } from "../../_lib/partnerEmails.js";
import {
  ensurePartnerReferralCode,
  partnerFieldsFromInput,
  requireKind,
  type PartnerFieldsInput,
} from "../../_lib/partners.js";
import { defaultFeePercent } from "../../../src/store/lib/partnerTypes.js";
import type { Database } from "../../../src/types/database.js";

// POST /api/admin/partners   { kind, businessName, contactName, email, …, sendWelcome? }
//
// Owner-only (app role "admin"). Adds a partner the owner has already agreed
// terms with — the existing buying partner, a store met at a card show —
// straight to Active, without the public application form. Optionally sends
// the welcome email (with a referral partner's personal link).

type PartnerInsert = Database["public"]["Tables"]["partners"]["Insert"];

interface Body extends PartnerFieldsInput {
  kind?: unknown;
  sendWelcome?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    if (staff.role !== "admin") throw new HttpError(403, "Only the store owner can add partners.");

    const body = (await readJsonBody(req, 16 * 1024)) as Body;
    const kind = requireKind(body.kind);
    const fields = partnerFieldsFromInput(body, kind);
    if (!fields.business_name || !fields.contact_name || !fields.email) {
      throw new HttpError(400, "Business name, contact name and email are required.");
    }
    if (kind === "store" && !(fields.categories && fields.categories.length > 0)) {
      throw new HttpError(400, "Choose at least one thing this store buys.");
    }

    const now = new Date().toISOString();
    const insert: PartnerInsert = {
      ...fields,
      kind,
      business_name: fields.business_name,
      contact_name: fields.contact_name,
      email: fields.email,
      categories: kind === "store" ? (fields.categories ?? []) : [],
      profession: kind === "referrer" ? (fields.profession ?? "other") : null,
      fee_percent: fields.fee_percent ?? defaultFeePercent(kind),
      status: "active",
      approved_at: now,
      // Added by the owner, who agreed the standards with them directly.
      agreed_to_standards_at: now,
    };

    const admin = getSupabaseAdmin();
    const { data: partner, error } = await admin.from("partners").insert(insert).select("id").single();
    if (error || !partner) {
      console.error("[/api/admin/partners] insert failed:", error);
      throw new HttpError(500, "Could not add the partner.");
    }

    if (kind === "referrer") await ensurePartnerReferralCode(admin, partner.id);

    let welcome: string | null = null;
    if (body.sendWelcome === true) {
      const result = await sendPartnerApprovedEmail(partner.id);
      welcome = result.status;
    }

    await logAdminAction(admin, staff, {
      action: "partner.create",
      resourceType: "partner",
      resourceId: partner.id,
      before: null,
      after: { kind, business_name: insert.business_name, fee_percent: insert.fee_percent, status: "active" },
    });

    return sendJson(res, 200, { ok: true, id: partner.id, welcome });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/admin/partners] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
