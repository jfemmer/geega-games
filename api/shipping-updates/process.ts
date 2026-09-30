import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runShippingUpdates } from "../_lib/shippingUpdates.js";

// GET/POST /api/shipping-updates/process — run hourly by Supabase pg_cron
// (migration 20260930150000_shipping_updates.sql), like the other workers
// (checkout recovery, stock alerts). Marks tracked orders delivered when the
// carrier says so, and sends the delivered email or, for untracked Plain
// White Envelope orders, the "should have arrived" check-in. See
// api/_lib/shippingUpdates.ts.
//
// Like those workers it needs no login: it can't choose recipients or
// orders, only follow up on shipped orders already in the database, each at
// most once an hour, and every email is one per order. Preview deployments
// share the production database, so they never run it.

export const config = { maxDuration: 60 };

const TIME_BUDGET_MS = 40_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return res.status(200).json({ ok: true, skipped: "not production" });
  }

  try {
    const summary = await runShippingUpdates({ timeBudgetMs: TIME_BUDGET_MS });
    // Counts only; no addresses in the logs.
    console.log("[/api/shipping-updates/process]", JSON.stringify(summary));
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("[/api/shipping-updates/process] failed:", err);
    return res.status(500).json({ ok: false, message: "Shipping updates failed." });
  }
}
