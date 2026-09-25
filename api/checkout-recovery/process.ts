import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { sendTrackedEmail } from "../_lib/emailService.js";
import { ServerEnv } from "../_lib/env.js";
import { logoUrl, siteUrl } from "../_lib/assets.js";
import { CheckoutRecovery, checkoutRecoveryText } from "../_lib/emails/CheckoutRecovery.js";

// This worker intentionally accepts GET/POST without customer auth — same
// shape as api/deck-alerts/process.ts and api/stock-alerts/process.ts. It
// cannot choose recipients: it only reads orders that are already sitting in
// the database with a non-paid status, online orders only (a POS order in
// this state is just a register sale still being rung up, not "abandoned").
//
// One email per order, ever — enforced by sendTrackedEmail's permanent
// idempotency key (checkout-recovery-<order-id>), not by any extra column
// here, so re-scanning the same order across multiple runs is harmless.
const MIN_AGE_MS = 60 * 60 * 1000; // give checkout an hour to complete normally
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // a week-old abandoned cart isn't worth nagging about

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }

  const db = getSupabaseAdmin();
  const now = Date.now();
  const { data: orders, error } = await db
    .from("orders")
    .select("id, email, user_id, created_at")
    .eq("channel", "online")
    .neq("payment_status", "paid")
    .not("email", "is", null)
    .lt("created_at", new Date(now - MIN_AGE_MS).toISOString())
    .gt("created_at", new Date(now - MAX_AGE_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[checkout-recovery] query failed", error);
    return res.status(500).json({ ok: false });
  }

  let sent = 0;
  let failed = 0;
  let deduped = 0;
  let superseded = 0;

  for (const order of orders ?? []) {
    try {
      // Each "Continue to payment" creates a new order (releasing the
      // previous hold), so a customer who came back — and maybe paid — has
      // a newer online order. Only nag about their most recent checkout.
      // Guest checkouts have no account, so match them by email instead.
      const newerQuery = db
        .from("orders")
        .select("id")
        .eq("channel", "online")
        .gt("created_at", order.created_at)
        .limit(1);
      const { data: newer } = order.user_id
        ? await newerQuery.eq("user_id", order.user_id)
        : await newerQuery.is("user_id", null).eq("email", order.email as string);
      if (newer && newer.length > 0) {
        superseded += 1;
        continue;
      }

      let firstName: string | null = null;
      if (order.user_id) {
        const { data: profile } = await db
          .from("profiles")
          .select("first_name")
          .eq("id", order.user_id)
          .maybeSingle();
        firstName = profile?.first_name ?? null;
      }

      const data = {
        firstName,
        shopUrl: `${siteUrl()}/shop`,
        siteUrl: siteUrl(),
        logoUrl: logoUrl(),
        supportEmail: ServerEnv.replyTo(),
      };

      const result = await sendTrackedEmail({
        emailType: "checkout_recovery",
        idempotencyKey: `checkout-recovery-${order.id}`,
        to: order.email as string,
        from: ServerEnv.fromMarketing(),
        replyTo: ServerEnv.replyTo(),
        subject: "Still want those cards? — Geega Games",
        react: CheckoutRecovery(data),
        text: checkoutRecoveryText(data),
        orderId: order.id,
      });

      if (result.status === "failed") failed += 1;
      else if (result.status === "deduped") deduped += 1;
      else sent += 1;
    } catch (err) {
      console.error("[checkout-recovery] send failed", order.id, err);
      failed += 1;
    }
  }

  return res.status(200).json({
    ok: true,
    processed: (orders ?? []).length,
    sent,
    failed,
    deduped,
    superseded,
  });
}
