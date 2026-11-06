import type { VercelRequest, VercelResponse } from "@vercel/node";
import { expireStaleHolds } from "../_lib/checkoutHolds.js";
import { runTradeWorker } from "../_lib/tradeExpiry.js";
import { allowWorkerRequest } from "../_lib/cronAuth.js";

// GET/POST /api/checkout/expire-holds — run every 5 minutes by pg_cron
// (migration 20260924050000). Returns the cards of checkouts that were
// never paid to stock; see api/_lib/checkoutHolds.ts. Then the Trade
// Center's turn (api/_lib/tradeExpiry.ts): deposit payments and refunds
// are reconciled with Stripe, trade packages are checked with the carrier,
// approvals whose cards sold go back to the customer, deadlines that ran out
// close or expire trades (releasing reserved cards), and customers and staff
// get their reminders. A trade problem never stops the checkout part.
//
// Only pg_cron can call it (allowWorkerRequest: the shared worker secret,
// production only). It takes no input and only acts on deadlines that have
// already passed (or payments and scans that already happened), so an extra
// run is harmless.
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowWorkerRequest(req, res)) return;
  try {
    const counts = await expireStaleHolds();
    const trades = await runTradeWorker();
    return res.status(200).json({ ok: true, ...counts, ...trades });
  } catch (err) {
    console.error("[expire-holds] failed", err);
    return res.status(500).json({ ok: false });
  }
}
