import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../_lib/http.js";
import { requireStaff } from "../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { logAdminAction } from "../_lib/auditLog.js";
import { sendReferralFeePaidEmail, sendReferralRewardEmail } from "../_lib/partnerEmails.js";
import { agreementInForce } from "../_lib/partnerAgreements.js";
import { referralWindow } from "../../src/store/lib/partnerAgreement.js";
import { SELLER_REFERRAL_REWARD_CENTS, feeCents } from "../../src/store/lib/partnerTypes.js";

// POST  /api/admin/referral-rewards        { leadType, leadId }
//   Rewards whoever referred a seller who sold — to Geega Games (a completed
//   Magic submission) or to a partner store (a referral marked "Sold"):
//     * a customer's code  → SELLER_REFERRAL_REWARD_CENTS of store credit,
//       issued at once;
//     * a referral partner → their fee % of the sale, as cash owed — only
//       for a completed Magic submission (Geega Games bought it directly),
//       only when the seller's request came in while a fully executed
//       Referral Partner Agreement was in effect, at the fee in that
//       agreement (version 2, 15.2: the version in force when the request
//       was recorded), and only if the purchase closed in time: within
//       REFERRAL_WINDOW_DAYS of the request, plus the 30-day Completion
//       Extension under version 2 when the seller accepted the offer within
//       those days (referralWindow()). Collections passed to a partner store
//       earn a referral partner nothing (version 2, 5.3). The partner is
//       emailed a Transaction Summary.
//   grant_referral_reward() does it in one transaction, and a lead can only
//   ever be rewarded once (unique lead columns), so a double click is safe.
// PATCH /api/admin/referral-rewards?id=…   { status: "paid" }
//   Marks a referral partner's cash reward paid and emails them the payment
//   statement (version 2, 6.6).
//
// Owner-only (app role "admin"): this pays out money.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });

interface Body {
  leadType?: unknown;
  leadId?: unknown;
  status?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "PATCH") return methodNotAllowed(res, ["POST", "PATCH"]);
  try {
    const staff = await requireStaff(req);
    if (staff.role !== "admin") throw new HttpError(403, "Only the store owner can pay referral rewards.");
    const admin = getSupabaseAdmin();
    const body = (await readJsonBody(req, 2048)) as Body;

    if (req.method === "PATCH") {
      const id = String(req.query.id ?? "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "Reward id is required.");
      if (body.status !== "paid") throw new HttpError(400, "Invalid status.");
      const { data: reward, error } = await admin
        .from("referral_rewards")
        .select("id, kind, status, amount_cents")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!reward) throw new HttpError(404, "Reward not found.");
      if (reward.status === "paid") return sendJson(res, 200, { ok: true, unchanged: true });
      const { error: updateErr } = await admin
        .from("referral_rewards")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", id);
      if (updateErr) throw new HttpError(500, updateErr.message);
      await logAdminAction(admin, staff, {
        action: "referral_reward.paid",
        resourceType: "referral_reward",
        resourceId: id,
        before: { status: reward.status },
        after: { status: "paid", amount_cents: reward.amount_cents },
      });
      try {
        await sendReferralFeePaidEmail(id);
      } catch (err) {
        console.error("[/api/admin/referral-rewards] payment statement failed:", err);
      }
      return sendJson(res, 200, { ok: true });
    }

    const leadType = body.leadType === "referral_lead" || body.leadType === "sell_submission" ? body.leadType : null;
    const leadId = typeof body.leadId === "string" && UUID_RE.test(body.leadId) ? body.leadId : null;
    if (!leadType || !leadId) throw new HttpError(400, "Choose a lead.");

    // The lead, its referral code, and what it sold for.
    let reference: string;
    let refCode: string | null;
    let sellerEmail: string;
    let saleCents: number | null = null;
    /** Geega Games itself bought it (a completed submission), not a partner store. */
    let directPurchase = false;
    let requestedAt: string | null = null;
    let closedAt: string | null = null;
    let offerAcceptedAt: string | null = null;
    const soldReferral = await admin
      .from("partner_referrals")
      .select("sale_amount_cents")
      .eq(leadType === "referral_lead" ? "referral_lead_id" : "sell_submission_id", leadId)
      .eq("outcome", "sold")
      .order("outcome_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (soldReferral.error) throw new HttpError(500, soldReferral.error.message);

    if (leadType === "referral_lead") {
      const { data: lead, error } = await admin
        .from("referral_leads")
        .select("reference_number, ref_code, email")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!lead) throw new HttpError(404, "Lead not found.");
      reference = lead.reference_number;
      refCode = lead.ref_code;
      sellerEmail = lead.email;
      if (!soldReferral.data) throw new HttpError(409, "Record the sale on the partner store referral first.");
      saleCents = soldReferral.data.sale_amount_cents;
    } else {
      const { data: sub, error } = await admin
        .from("sell_submissions")
        .select("reference_number, ref_code, email, status, purchase_amount_cents, created_at, closed_at, offer_response, offer_responded_at")
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!sub) throw new HttpError(404, "Submission not found.");
      reference = sub.reference_number;
      refCode = sub.ref_code;
      sellerEmail = sub.email;
      requestedAt = sub.created_at;
      closedAt = sub.closed_at;
      offerAcceptedAt = sub.offer_response === "accepted" ? sub.offer_responded_at : null;
      if (sub.status === "completed") {
        saleCents = sub.purchase_amount_cents;
        directPurchase = true;
      }
      else if (soldReferral.data) saleCents = soldReferral.data.sale_amount_cents;
      else throw new HttpError(409, "Mark the purchase completed (or the partner store sale) first.");
    }
    if (!refCode) throw new HttpError(409, "Nobody referred this seller.");

    const { data: code, error: codeErr } = await admin
      .from("referral_codes")
      .select("code, user_id, partner_id")
      .eq("code", refCode)
      .maybeSingle();
    if (codeErr) throw new HttpError(500, codeErr.message);
    if (!code) throw new HttpError(409, "That referral code no longer exists.");

    let kind: "store_credit" | "cash";
    let amountCents: number;
    let feePercent: number | undefined;
    if (code.user_id) {
      const { data: user } = await admin.auth.admin.getUserById(code.user_id);
      if (user?.user?.email && user.user.email.toLowerCase() === sellerEmail.toLowerCase()) {
        throw new HttpError(409, "The seller referred themselves, so there's no reward.");
      }
      kind = "store_credit";
      amountCents = SELLER_REFERRAL_REWARD_CENTS;
    } else if (code.partner_id) {
      const { data: partner, error } = await admin
        .from("partners")
        .select("id, business_name")
        .eq("id", code.partner_id)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!partner) throw new HttpError(409, "That referral partner no longer exists.");
      if (!directPurchase) {
        throw new HttpError(
          409,
          "No referral fee: under the Referral Partner Agreement, a fee is earned only when Geega Games buys the collection itself and the purchase is completed, not when it's sold to a partner store.",
        );
      }
      // The agreement in force when the seller's request came in.
      const requested = requestedAt ?? new Date().toISOString();
      const { agreement, earliest } = await agreementInForce(admin, partner.id, requested);
      if (!agreement) {
        throw new HttpError(
          409,
          earliest
            ? `No referral fee: the seller's request (${dateLabel(requested)}) came in before ${partner.business_name}'s Referral Partner Agreement took effect (${dateLabel(earliest.effective_at)}). Requests before then don't qualify.`
            : `No referral fee: ${partner.business_name} has no Referral Partner Agreement in effect (signed by them and, for version 2, countersigned by you).`,
        );
      }
      feePercent = Number(agreement.fee_percent);
      const window = referralWindow({
        agreementVersion: agreement.version_number,
        requestedAt: requested,
        closedAt: closedAt ?? new Date().toISOString(),
        offerAcceptedAt,
      });
      if (!window.ok) {
        throw new HttpError(
          409,
          `No referral fee: the purchase closed more than ${window.allowedDays} days after the seller's request (agreement ${window.section}).`,
        );
      }
      if (!saleCents) throw new HttpError(409, "Enter what the seller was paid first, so the fee can be worked out.");
      kind = "cash";
      amountCents = feeCents(saleCents, feePercent);
      if (amountCents <= 0) throw new HttpError(409, "This partner's fee works out to $0.");
    } else {
      throw new HttpError(409, "That referral code has no owner.");
    }

    const { data: rewardId, error: grantErr } = await admin.rpc("grant_referral_reward", {
      p_referral_lead_id: leadType === "referral_lead" ? leadId : null,
      p_sell_submission_id: leadType === "sell_submission" ? leadId : null,
      p_lead_reference: reference,
      p_ref_code: code.code,
      p_user_id: code.user_id,
      p_partner_id: code.partner_id,
      p_kind: kind,
      p_amount_cents: amountCents,
      p_created_by: staff.userId,
    });
    if (grantErr) {
      if (grantErr.code === "23505") throw new HttpError(409, "This referral was already rewarded.");
      throw new HttpError(500, grantErr.message);
    }

    try {
      await sendReferralRewardEmail(rewardId as string, { feePercent });
    } catch (err) {
      console.error("[/api/admin/referral-rewards] reward email failed:", err);
    }

    await logAdminAction(admin, staff, {
      action: "referral_reward.grant",
      resourceType: leadType,
      resourceId: leadId,
      before: null,
      after: { reward_id: rewardId, kind, amount_cents: amountCents, ref_code: code.code },
    });

    return sendJson(res, 200, { ok: true, rewardId, kind, amountCents });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/admin/referral-rewards] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
