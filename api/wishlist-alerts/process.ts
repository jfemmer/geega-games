import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { sendTrackedEmail } from "../_lib/emailService.js";
import { ServerEnv } from "../_lib/env.js";
import { logoUrl, siteUrl } from "../_lib/assets.js";
import {
  WishlistAlert,
  wishlistAlertSubject,
  wishlistAlertText,
  type WishlistAlertItem,
} from "../_lib/emails/WishlistAlert.js";
import { slugifyCardName } from "../../src/store/lib/cardSlug.js";

// Wishlist alert worker (cron: geega-wishlist-alert-worker, every 15 min).
//
// Same trust model as api/deck-alerts/process.ts: it accepts GET/POST with no
// customer auth, but cannot choose recipients or invent alerts. It only
//   1. runs wishlist_alert_scan() (service_role only), which queues events
//      for real wishlist rows whose live inventory changed, then
//   2. drains unsent wishlist_alert_events into ONE digest email per customer.
// sendTrackedEmail's idempotency key is a hash of the exact event ids, so a
// retried run can never double-send the same digest.

const PENDING_LIMIT = 300;
const MIN_HOURS_BETWEEN_EMAILS = 3;
const MAX_ITEMS_PER_EMAIL = 12;

type EventRow = {
  id: string;
  user_id: string;
  oracle_id: string;
  card_name: string;
  kind: WishlistAlertItem["kind"];
  price_cents: number | null;
  previous_price_cents: number | null;
  created_at: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }

  // wishlist_alert_events / wishlist_alert_scan aren't in the generated types yet.
  const db = getSupabaseAdmin() as any;

  const scan = await db.rpc("wishlist_alert_scan");
  if (scan.error) {
    console.error("[wishlist-alerts] scan failed", scan.error);
    return res.status(500).json({ ok: false });
  }

  const { data: rows, error } = await db
    .from("wishlist_alert_events")
    .select("id, user_id, oracle_id, card_name, kind, price_cents, previous_price_cents, created_at")
    .is("email_sent_at", null)
    .is("email_error", null)
    .order("created_at", { ascending: true })
    .limit(PENDING_LIMIT);
  if (error) {
    console.error("[wishlist-alerts] queue load failed", error);
    return res.status(500).json({ ok: false });
  }

  const byUser = new Map<string, EventRow[]>();
  for (const row of (rows ?? []) as EventRow[]) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  let sent = 0;
  let deferred = 0;
  let skipped = 0;
  let failed = 0;
  const cooldownStart = new Date(Date.now() - MIN_HOURS_BETWEEN_EMAILS * 3600_000).toISOString();

  for (const [userId, events] of byUser) {
    const eventIds = events.map((e) => e.id);
    try {
      // Spacing: at most one wishlist digest per customer per few hours. The
      // events stay queued and go out together in the next allowed digest.
      const { count: recent } = await db
        .from("wishlist_alert_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("email_sent_at", cooldownStart);
      if (recent) {
        deferred += 1;
        continue;
      }

      const { data: profile } = await db
        .from("profiles")
        .select("first_name, wishlist_alerts")
        .eq("id", userId)
        .maybeSingle();
      if (profile && profile.wishlist_alerts === false) {
        // Turned off after these were queued — never send them.
        await db
          .from("wishlist_alert_events")
          .update({ email_error: "Wishlist alerts turned off." })
          .in("id", eventIds);
        skipped += 1;
        continue;
      }

      // Latest event per card, and only cards still buyable right now (a
      // restock that sold out again before this run is not worth an email).
      const latestByCard = new Map<string, EventRow>();
      for (const e of events) latestByCard.set(e.oracle_id, e);
      const items: WishlistAlertItem[] = [];
      for (const e of latestByCard.values()) {
        const { count: available } = await db
          .from("inventory_items")
          .select("id", { count: "exact", head: true })
          .eq("oracle_id", e.oracle_id)
          .eq("status", "active")
          .gt("quantity", 0);
        if (!available) continue;
        items.push({
          kind: e.kind,
          cardName: e.card_name,
          productUrl: `${siteUrl()}/shop/card/${slugifyCardName(e.card_name)}`,
          priceCents: e.price_cents,
          previousPriceCents: e.previous_price_cents,
        });
      }

      if (items.length === 0) {
        await db
          .from("wishlist_alert_events")
          .update({ email_error: "No longer in stock when the digest ran." })
          .in("id", eventIds);
        skipped += 1;
        continue;
      }

      const { data: userData, error: userError } = await db.auth.admin.getUserById(userId);
      const email = userData?.user?.email;
      if (userError || !email) {
        await db
          .from("wishlist_alert_events")
          .update({ email_error: "Account email unavailable." })
          .in("id", eventIds);
        failed += 1;
        continue;
      }

      const shown = items.slice(0, MAX_ITEMS_PER_EMAIL);
      const data = {
        firstName: profile?.first_name ?? null,
        items: shown,
        wishlistUrl: `${siteUrl()}/account/wishlist`,
        settingsUrl: `${siteUrl()}/account/notifications`,
        siteUrl: siteUrl(),
        logoUrl: logoUrl(),
        supportEmail: ServerEnv.replyTo(),
      };
      const digestKey = createHash("sha256").update([...eventIds].sort().join(",")).digest("hex").slice(0, 32);

      const result = await sendTrackedEmail({
        emailType: "wishlist_alert",
        idempotencyKey: `wishlist-${digestKey}`,
        to: email,
        from: ServerEnv.fromMarketing(),
        replyTo: ServerEnv.replyTo(),
        subject: wishlistAlertSubject(shown),
        react: WishlistAlert(data),
        text: wishlistAlertText(data),
      });

      if (result.status === "failed") {
        await db
          .from("wishlist_alert_events")
          .update({ email_error: result.error.slice(0, 500) })
          .in("id", eventIds);
        failed += 1;
      } else {
        await db
          .from("wishlist_alert_events")
          .update({ email_sent_at: new Date().toISOString() })
          .in("id", eventIds);
        sent += 1;
      }
    } catch (err) {
      console.error("[wishlist-alerts] digest failed", userId, err);
      failed += 1;
    }
  }

  return res.status(200).json({
    ok: true,
    queued: scan.data ?? 0,
    customers: byUser.size,
    sent,
    deferred,
    skipped,
    failed,
  });
}
