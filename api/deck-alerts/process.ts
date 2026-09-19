import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { sendTrackedEmail } from "../_lib/emailService.js";
import { ServerEnv } from "../_lib/env.js";
import { siteUrl } from "../_lib/assets.js";
import {
  DeckStockAlert,
  deckStockAlertText,
} from "../_lib/emails/DeckStockAlert.js";

// This worker intentionally accepts GET/POST without customer auth. It cannot
// choose recipients or create alerts: it only drains legitimate unsent rows
// created by the protected database inventory trigger. sendTrackedEmail adds a
// second permanent idempotency barrier, so retries are safe.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }

  const db = getSupabaseAdmin() as any;
  const { data: rows, error } = await db
    .from("deck_stock_notifications")
    .select("id, user_id, card_name, inventory_item_id, deck_names, created_at")
    .is("email_sent_at", null)
    .is("email_error", null)
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    console.error("[deck-alerts] queue load failed", error);
    return res.status(500).json({ ok: false });
  }

  let sent = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    try {
      const { data: userData, error: userError } =
        await db.auth.admin.getUserById(row.user_id);
      const email = userData.user?.email;
      if (userError || !email) {
        await db
          .from("deck_stock_notifications")
          .update({ email_error: "Account email unavailable." })
          .eq("id", row.id);
        failed += 1;
        continue;
      }

      const productUrl = row.inventory_item_id
        ? `${siteUrl()}/shop?q=${encodeURIComponent(row.card_name)}`
        : `${siteUrl()}/shop?q=${encodeURIComponent(row.card_name)}`;

      const result = await sendTrackedEmail({
        emailType: "deck_stock_alert",
        idempotencyKey: `deck-stock-${row.id}`,
        to: email,
        from: ServerEnv.fromMarketing(),
        replyTo: ServerEnv.replyTo(),
        subject: `${row.card_name} is back in stock — Geega Games`,
        react: DeckStockAlert({
          cardName: row.card_name,
          deckNames: row.deck_names ?? [],
          productUrl,
          siteUrl: siteUrl(),
        }) as any,
        text: deckStockAlertText({
          cardName: row.card_name,
          deckNames: row.deck_names ?? [],
          productUrl,
        }),
      });

      if (result.status === "failed") {
        await db
          .from("deck_stock_notifications")
          .update({ email_error: result.error.slice(0, 500) })
          .eq("id", row.id);
        failed += 1;
      } else {
        await db
          .from("deck_stock_notifications")
          .update({ email_sent_at: new Date().toISOString() })
          .eq("id", row.id);
        sent += 1;
      }
    } catch (err) {
      console.error("[deck-alerts] send failed", row.id, err);
      failed += 1;
    }
  }

  return res.status(200).json({
    ok: true,
    processed: (rows ?? []).length,
    sent,
    failed,
  });
}
