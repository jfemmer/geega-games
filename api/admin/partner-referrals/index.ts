import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import { sendLeadToPartnerEmails } from "../../_lib/partnerEmails.js";
import {
  leadPartnerCategories,
  partnerBuysAny,
  partnerCategoryLabel,
} from "../../../src/store/lib/partnerTypes.js";

// POST /api/admin/partner-referrals  { leadType, leadId, partnerId }
//
// Staff-only. Sends one lead to one partner store: records the referral (with
// the store's current fee %, so later fee changes don't rewrite it), emails
// the store the seller's details and the seller the store's name, and marks a
// partner lead "Sent to partner".
//
// Checks, in order:
//   * the store is an ACTIVE partner store that buys what the lead is selling;
//   * the seller agreed to be passed on — always true for a partner lead (no
//     consent, no lead), and only true for a Magic submission whose seller
//     ticked "if Geega Games passes, share it with a partner store";
//   * the lead isn't already with another store (one store per lead, enforced
//     by a unique index too).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  leadType?: unknown;
  leadId?: unknown;
  partnerId?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const staff = await requireStaff(req);
    const body = (await readJsonBody(req, 2048)) as Body;
    const leadType = body.leadType === "referral_lead" || body.leadType === "sell_submission" ? body.leadType : null;
    const leadId = typeof body.leadId === "string" && UUID_RE.test(body.leadId) ? body.leadId : null;
    const partnerId = typeof body.partnerId === "string" && UUID_RE.test(body.partnerId) ? body.partnerId : null;
    if (!leadType || !leadId || !partnerId) throw new HttpError(400, "Choose a lead and a partner store.");

    const admin = getSupabaseAdmin();

    const { data: partner, error: partnerErr } = await admin
      .from("partners")
      .select("id, kind, status, business_name, categories, fee_percent")
      .eq("id", partnerId)
      .maybeSingle();
    if (partnerErr) throw new HttpError(500, partnerErr.message);
    if (!partner || partner.kind !== "store") throw new HttpError(404, "Partner store not found.");
    if (partner.status !== "active") throw new HttpError(409, `${partner.business_name} isn't active right now.`);

    let reference: string;
    let leadCategories: string[];
    if (leadType === "referral_lead") {
      const { data: lead, error } = await admin
        .from("referral_leads")
        .select("id, reference_number, categories, consent_to_share_at")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!lead) throw new HttpError(404, "Lead not found.");
      if (!lead.consent_to_share_at) {
        throw new HttpError(409, "This seller didn't agree to be passed to a partner store, so it can't be sent.");
      }
      reference = lead.reference_number;
      leadCategories = leadPartnerCategories({ kind: "referral_lead", categories: lead.categories });
    } else {
      const { data: sub, error } = await admin
        .from("sell_submissions")
        .select("id, reference_number, partner_consent_at")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!sub) throw new HttpError(404, "Submission not found.");
      if (!sub.partner_consent_at) {
        throw new HttpError(409, "This seller didn't agree to be passed to a partner store, so it can't be sent.");
      }
      reference = sub.reference_number;
      leadCategories = leadPartnerCategories({ kind: "sell_submission" });
    }

    if (!partnerBuysAny(partner.categories, leadCategories)) {
      throw new HttpError(
        400,
        `${partner.business_name} doesn't buy ${leadCategories.map(partnerCategoryLabel).join(" or ")}.`,
      );
    }

    const { data: referral, error: insertErr } = await admin
      .from("partner_referrals")
      .insert({
        partner_id: partner.id,
        referral_lead_id: leadType === "referral_lead" ? leadId : null,
        sell_submission_id: leadType === "sell_submission" ? leadId : null,
        lead_reference: reference,
        sent_by: staff.userId,
        fee_percent: partner.fee_percent,
      })
      .select("id")
      .single();
    if (insertErr) {
      if (insertErr.code === "23505") {
        throw new HttpError(409, "This lead is already with a partner store. Record what happened there first.");
      }
      throw new HttpError(500, insertErr.message);
    }

    if (leadType === "referral_lead") {
      const { error } = await admin.from("referral_leads").update({ status: "sent_to_partner" }).eq("id", leadId);
      if (error) console.error("[/api/admin/partner-referrals] lead status not updated:", error.message);
    }

    const emails = await sendLeadToPartnerEmails(referral.id);

    await logAdminAction(admin, staff, {
      action: "partner_referral.send",
      resourceType: leadType,
      resourceId: leadId,
      before: null,
      after: { referral_id: referral.id, partner_id: partner.id, lead_reference: reference },
    });

    return sendJson(res, 200, {
      ok: true,
      referralId: referral.id,
      emails: { store: emails.store.status, seller: emails.seller.status },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/admin/partner-referrals] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
