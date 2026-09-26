import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowCronRequest } from "../_lib/cronAuth.js";
import { runReviewRequests } from "../_lib/reviewRequests.js";

// GET /api/review-requests/process — daily Vercel cron (see "crons" in
// vercel.json). Emails customers who now have their cards (or, for sellers,
// their money) a one-time request for an honest Google review. Who qualifies,
// and when, is in _lib/reviewRequests.ts.
//
// Only Vercel's scheduler can trigger it, and only on the production
// deployment (allowCronRequest).

// Emails go out one at a time. The run stops starting new ones at
// TIME_BUDGET_MS, well inside this limit; anything left goes out tomorrow.
export const config = { maxDuration: 60 };

const TIME_BUDGET_MS = 40_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowCronRequest(req, res)) return;
  try {
    const summary = await runReviewRequests({ timeBudgetMs: TIME_BUDGET_MS });
    // Counts only; no addresses in the logs.
    console.log("[/api/review-requests/process]", JSON.stringify(summary));
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("[/api/review-requests/process] failed:", err);
    return res.status(500).json({ ok: false, message: "Review requests failed." });
  }
}
