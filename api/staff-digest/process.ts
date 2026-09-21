import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { sendTrackedEmail } from "../_lib/emailService.js";
import { ServerEnv } from "../_lib/env.js";
import { logoUrl, siteUrl } from "../_lib/assets.js";
import { StaffDigest, staffDigestText, type StaffDigestEmailData } from "../_lib/emails/StaffDigest.js";

// Cron-triggered (see geega-staff-digest-worker, once daily). No customer
// auth: it can only read aggregate counts and email the store's own staff
// inbox, same trust shape as the other cron workers. Idempotent per calendar
// day via sendTrackedEmail's idempotency key, so a retried run never sends
// two digests for the same day.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }

  const db = getSupabaseAdmin();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const dayKey = now.toISOString().slice(0, 10);

  try {
    const [
      newOrdersRes,
      newLeadsRes,
      newSignupsRes,
      newSubscribersRes,
      needsPackingRes,
      pendingPickupsRes,
      lowStockRes,
    ] = await Promise.all([
      db
        .from("orders")
        .select("total_cents", { count: "exact" })
        .eq("payment_status", "paid")
        .gte("paid_at", since),
      db
        .from("sell_submissions")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since),
      db
        .from("newsletter_subscribers")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      db.from("orders").select("id", { count: "exact", head: true }).eq("status", "paid"),
      db
        .from("pickup_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["waiting", "ready"]),
      db
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .gt("quantity", 0)
        .lte("quantity", 2),
    ]);

    const newOrdersRevenueCents = (newOrdersRes.data ?? []).reduce(
      (sum, o) => sum + (o.total_cents ?? 0),
      0,
    );

    const data: StaffDigestEmailData = {
      dateLabel: now.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      newOrders: newOrdersRes.count ?? 0,
      newOrdersRevenueCents,
      newLeads: newLeadsRes.count ?? 0,
      newSignups: newSignupsRes.count ?? 0,
      newSubscribers: newSubscribersRes.count ?? 0,
      ordersNeedingPacking: needsPackingRes.count ?? 0,
      pendingPickups: pendingPickupsRes.count ?? 0,
      lowStockCount: lowStockRes.count ?? 0,
      adminUrl: `${siteUrl()}/admin_dashboard`,
      siteUrl: siteUrl(),
      logoUrl: logoUrl(),
      supportEmail: ServerEnv.replyTo(),
    };

    const result = await sendTrackedEmail({
      emailType: "staff_digest",
      idempotencyKey: `staff-digest-${dayKey}`,
      to: ServerEnv.orderNotificationEmail(),
      from: ServerEnv.fromMarketing(),
      subject: `Geega Games daily digest — ${data.dateLabel}`,
      react: StaffDigest(data),
      text: staffDigestText(data),
    });

    return res.status(200).json({ ok: true, status: result.status });
  } catch (err) {
    console.error("[staff-digest] failed", err);
    return res.status(500).json({ ok: false });
  }
}
