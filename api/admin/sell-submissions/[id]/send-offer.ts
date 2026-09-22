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

interface Body {
  offerValueCents?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    await requireStaff(req);
    const id = String(req.query.id ?? "");
    if (!id) throw new HttpError(400, "Submission id is required.");

    const body = (await readJsonBody(req)) as Body;
    const offerValueCents = Math.round(Number(body.offerValueCents));
    if (!Number.isFinite(offerValueCents) || offerValueCents <= 0) {
      throw new HttpError(400, "A positive offer amount is required.");
    }

    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("sell_submissions")
      .update({
        offer_value_cents: offerValueCents,
        status: "offer_made",
        offer_sent_at: now,
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Submission not found.");

    // The submission is already updated either way — an email failure here
    // must not roll that back or block staff from seeing the new status.
    try {
      await sendSellSubmissionOffer(id, offerValueCents);
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
