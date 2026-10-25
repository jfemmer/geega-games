import type { VercelRequest, VercelResponse } from "@vercel/node";
import { expireStaleHolds } from "../_lib/checkoutHolds.js";
import { runTradeWorker } from "../_lib/tradeExpiry.js";

// GET/POST /api/checkout/expire-holds — run every 5 minutes by pg_cron
// (migration 20260924050000). Returns the cards of checkouts that were
// never paid to stock; see api/_lib/checkoutHolds.ts. Then the Trade
// Center's turn (api/_lib/tradeExpiry.ts): trades whose hold ran out with
// nothing shipped to us are expired and their cards released, and
// customers and staff get their deadline reminders. A trade problem never
// stops the checkout part.
//
// Same unauthenticated worker shape as api/checkout-recovery/process.ts: it
// takes no input and can only release holds that are already past their
// expiry, so calling it early or often is harmless.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }
  try {
    const counts = await expireStaleHolds();
    const trades = await runTradeWorker();
    return res.status(200).json({ ok: true, ...counts, ...trades });
  } catch (err) {
    console.error("[expire-holds] failed", err);
    return res.status(500).json({ ok: false });
  }
}
