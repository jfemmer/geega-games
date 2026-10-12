import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { sendPartnerReferralCheckin } from "../_lib/partnerEmails.js";
import { CHECKIN_AFTER_DAYS } from "../../src/store/lib/partnerTypes.js";

// GET/POST /api/partner-referrals/process — run daily by Supabase pg_cron
// (migration 20261011210000_partner_checkin_worker.sql), like the other
// workers. For every lead that went to a partner store CHECKIN_AFTER_DAYS ago
// and still has no outcome, it emails the seller "did they get in touch?" —
// once per referral (checkin_sent_at, plus the email's idempotency key).
//
// Like those workers it needs no login: it can't choose recipients, only
// follow up on referrals already in the database, each at most once. Preview
// deployments share the production database, so they never run it.

export const config = { maxDuration: 60 };

const BATCH_SIZE = 50;
const TIME_BUDGET_MS = 40_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return res.status(200).json({ ok: true, skipped: "not production" });
  }

  const started = Date.now();
  const summary = { due: 0, sent: 0, skipped: 0, failed: 0 };
  try {
    const db = getSupabaseAdmin();
    const dueBefore = new Date(Date.now() - CHECKIN_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: due, error } = await db
      .from("partner_referrals")
      .select("id")
      .eq("outcome", "pending")
      .is("checkin_sent_at", null)
      .lte("sent_at", dueBefore)
      .order("sent_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (error) throw new Error(error.message);
    summary.due = due?.length ?? 0;

    for (const { id } of due ?? []) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const result = await sendPartnerReferralCheckin(id);
      if (result.status === "failed") {
        summary.failed += 1;
        continue; // try again tomorrow
      }
      // Sent, already sent (deduped) or nothing to send (lead deleted,
      // outcome already known): don't look at this referral again.
      const { error: markErr } = await db
        .from("partner_referrals")
        .update({ checkin_sent_at: new Date().toISOString() })
        .eq("id", id);
      if (markErr) console.error("[/api/partner-referrals/process] mark failed:", id, markErr.message);
      if (result.status === "sent" || result.status === "deduped") summary.sent += 1;
      else summary.skipped += 1;
    }

    console.log("[/api/partner-referrals/process]", JSON.stringify(summary));
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("[/api/partner-referrals/process] failed:", err);
    return res.status(500).json({ ok: false, message: "Partner check-ins failed." });
  }
}
