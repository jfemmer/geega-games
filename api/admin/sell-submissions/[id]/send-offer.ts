import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
} from "../../../_lib/http.js";
import { requireStaff } from "../../../_lib/adminAuth.js";
import { getSupabaseAdmin } from "../../../_lib/supabaseAdmin.js";
import { sendSellSubmissionOffer } from "../../../_lib/sellSubmissionEmails.js";

// POST /api/admin/sell-submissions/:id/send-offer
//
// The ONLY way an offer amount actually reaches a seller — the plain PATCH
// endpoint's offerValueCents field is just a private staff note (see its own
// comment). This records the amount, marks the submission offer_made +
// offer_sent_at, and sends the one email that states the dollar figure.
// Staff-only, same as every other admin write to this table.
//
// Resets offer_response / counter_offer_cents / offer_responded_at back to
// null on every send: this is how staff re-offer after a decline or counter
// (the normal negotiation loop — see api/sell/respond-to-offer.ts), and a
// stale response from a PRIOR offer must never be mistaken for a response to
// THIS one. Without this reset, a seller who countered offer #1 would find
// the public /sell/offer page permanently showing "you already responded"
// even after staff sent a brand-new offer #2.
//
// Every offer carries two amounts (migration 20261102120000): the PayPal
// amount (offerValueCents) and the store-credit amount (creditOfferCents),
// both worked out by staff from the published rates (src/store/lib/
// buyTerms.ts). The seller picks one when they accept, and the credit amount
// is what the DB issues if they pick store credit.

interface Body {
  offerValueCents?: unknown;
  creditOfferCents?: unknown;
}

/** The largest offer this endpoint takes: a typo guard, not a business limit. */
const MAX_OFFER_CENTS = 100_000_000;

function positiveCents(value: unknown): number | null {
  const cents = Math.round(Number(value));
  return Number.isFinite(cents) && cents > 0 && cents <= MAX_OFFER_CENTS ? cents : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Submission id is required.");

    const body = (await readJsonBody(req)) as Body;
    const offerValueCents = positiveCents(body.offerValueCents);
    if (offerValueCents == null) {
      throw new HttpError(400, "A positive PayPal offer amount is required.");
    }
    const creditOfferCents = positiveCents(body.creditOfferCents);
    if (creditOfferCents == null) {
      throw new HttpError(400, "A positive store-credit offer amount is required.");
    }

    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("sell_submissions")
      .update({
        offer_value_cents: offerValueCents,
        credit_offer_cents: creditOfferCents,
        status: "offer_made",
        offer_sent_at: now,
        offer_response: null,
        counter_offer_cents: null,
        offer_responded_at: null,
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Submission not found.");

    // The submission is already updated either way — an email failure here
    // must not roll that back or block staff from seeing the new status.
    try {
      await sendSellSubmissionOffer(id, offerValueCents, creditOfferCents);
    } catch (mailErr) {
      console.error("[admin/sell-submissions/send-offer] email failed", mailErr);
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : "Unexpected server error.";
    return sendJson(res, status, { ok: false, message });
  }
}
