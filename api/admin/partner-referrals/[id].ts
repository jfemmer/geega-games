import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HttpError, methodNotAllowed, readJsonBody, sendJson } from "../../_lib/http.js";
import { requireStaff } from "../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin.js";
import { logAdminAction } from "../../_lib/auditLog.js";
import {
  REOPENING_OUTCOMES,
  feeCents,
  isFeeStatus,
  isPartnerReferralOutcome,
  type FeeStatus,
  type PartnerReferralOutcome,
} from "../../../src/store/lib/partnerTypes.js";
import type { Database } from "../../../src/types/database.js";

// PATCH /api/admin/partner-referrals/:id  { outcome?, saleAmountCents?, feeStatus?, notes? }
//
// Staff record what came of a lead sent to a partner store. The server works
// out the fee — the referral's fee % of the sale — so nobody does the math by
// hand. Rules:
//   * "Sold" needs the sale amount; the fee becomes Owed (unless already paid
//     or waived).
//   * Any other outcome clears the sale and fee — refused if the fee was
//     already marked paid (so is changing a paid sale's amount).
//   * Marking a fee Paid or Waived is owner-only (app role "admin").
// It also moves the partner lead along: sold / didn't sell → Closed; store
// passed / couldn't reach them → back to New, ready for another store;
// waiting → Sent to partner.

type ReferralUpdate = Database["public"]["Tables"]["partner_referrals"]["Update"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SALE_CENTS = 100_000_000; // $1,000,000 — a typo guard, not a business rule.

interface Body {
  outcome?: unknown;
  saleAmountCents?: unknown;
  feeStatus?: unknown;
  notes?: unknown;
}

function leadStatusFor(outcome: PartnerReferralOutcome): "new" | "sent_to_partner" | "closed" {
  if (outcome === "pending") return "sent_to_partner";
  if ((REOPENING_OUTCOMES as readonly string[]).includes(outcome)) return "new";
  return "closed";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    const staff = await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!UUID_RE.test(id)) throw new HttpError(400, "Referral id is required.");
    const body = (await readJsonBody(req, 4096)) as Body;

    const admin = getSupabaseAdmin();
    const { data: referral, error: readErr } = await admin
      .from("partner_referrals")
      .select("id, outcome, sale_amount_cents, fee_percent, fee_cents, fee_status, referral_lead_id, notes")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw new HttpError(500, readErr.message);
    if (!referral) throw new HttpError(404, "Referral not found.");

    const currentOutcome = referral.outcome as PartnerReferralOutcome;
    const currentFeeStatus = referral.fee_status as FeeStatus;

    if (body.outcome !== undefined && !isPartnerReferralOutcome(body.outcome)) throw new HttpError(400, "Invalid outcome.");
    if (body.feeStatus !== undefined && !isFeeStatus(body.feeStatus)) throw new HttpError(400, "Invalid fee status.");
    let saleAmount: number | null | undefined;
    if (body.saleAmountCents !== undefined) {
      if (body.saleAmountCents === null) saleAmount = null;
      else {
        const n = Number(body.saleAmountCents);
        if (!Number.isInteger(n) || n < 0 || n > MAX_SALE_CENTS) throw new HttpError(400, "Enter the sale amount in dollars and cents.");
        saleAmount = n;
      }
    }

    const outcome = (body.outcome as PartnerReferralOutcome | undefined) ?? currentOutcome;
    const update: ReferralUpdate = {};

    if (outcome !== currentOutcome) {
      update.outcome = outcome;
      update.outcome_at = outcome === "pending" ? null : new Date().toISOString();
    }

    if (outcome === "sold") {
      const sale = saleAmount !== undefined ? saleAmount : referral.sale_amount_cents;
      if (sale === null || sale === undefined) throw new HttpError(400, "Enter what the store paid the seller.");
      // A paid fee is money already received: its amount can't drift under it.
      if (currentFeeStatus === "paid" && sale !== referral.sale_amount_cents) {
        throw new HttpError(409, "This fee is marked paid. Change the fee status first to correct the sale.");
      }
      const fee = feeCents(sale, Number(referral.fee_percent));
      update.sale_amount_cents = sale;
      update.fee_cents = fee;
      if (currentFeeStatus !== "paid" && currentFeeStatus !== "waived") {
        update.fee_status = fee > 0 ? "owed" : "none";
      }
    } else if (outcome !== currentOutcome || saleAmount !== undefined) {
      if (currentFeeStatus === "paid") {
        throw new HttpError(409, "This fee is marked paid. Change the fee status first if the sale fell through.");
      }
      update.sale_amount_cents = null;
      update.fee_cents = null;
      update.fee_status = "none";
      update.fee_paid_at = null;
    }

    if (body.feeStatus !== undefined && body.feeStatus !== currentFeeStatus) {
      const feeStatus = body.feeStatus as FeeStatus;
      if ((feeStatus === "paid" || feeStatus === "waived" || currentFeeStatus === "paid") && staff.role !== "admin") {
        throw new HttpError(403, "Only the store owner can mark fees paid or waived.");
      }
      if (outcome !== "sold" && feeStatus !== "none") throw new HttpError(400, "Only a sale has a fee.");
      update.fee_status = feeStatus;
      update.fee_paid_at = feeStatus === "paid" ? new Date().toISOString() : null;
    }

    if (body.notes !== undefined) {
      update.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
    }

    if (Object.keys(update).length === 0) return sendJson(res, 200, { ok: true, unchanged: true });

    const { data: saved, error: updateErr } = await admin
      .from("partner_referrals")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (updateErr) throw new HttpError(500, updateErr.message);

    if (referral.referral_lead_id && update.outcome) {
      const { error } = await admin
        .from("referral_leads")
        .update({ status: leadStatusFor(outcome) })
        .eq("id", referral.referral_lead_id);
      if (error) console.error("[/api/admin/partner-referrals/:id] lead status not updated:", error.message);
    }

    await logAdminAction(admin, staff, {
      action: "partner_referral.update",
      resourceType: "partner_referral",
      resourceId: id,
      before: {
        outcome: currentOutcome,
        sale_amount_cents: referral.sale_amount_cents,
        fee_cents: referral.fee_cents,
        fee_status: currentFeeStatus,
      },
      after: update as Record<string, unknown>,
    });

    return sendJson(res, 200, { ok: true, referral: saved });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    if (!(err instanceof HttpError)) console.error("[/api/admin/partner-referrals/:id] error:", err);
    return sendJson(res, status, { ok: false, message });
  }
}
