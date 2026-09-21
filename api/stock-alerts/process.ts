import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { sendTrackedEmail } from "../_lib/emailService.js";
import { ServerEnv } from "../_lib/env.js";
import { logoUrl, siteUrl } from "../_lib/assets.js";
import { CardBackInStock, cardBackInStockText } from "../_lib/emails/CardBackInStock.js";
import { slugifyCardName } from "../../src/store/lib/cardSlug.js";

// This worker intentionally accepts GET/POST without customer auth — same
// shape as api/deck-alerts/process.ts. It cannot choose recipients: it only
// drains pending rows a customer explicitly created via
// /api/stock-alerts/subscribe, and rechecks stock itself rather than
// trusting a trigger, so a subscription only ever emails once the card is
// actually, currently purchasable.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }

  const db = getSupabaseAdmin();
  const { data: rows, error } = await db
    .from("card_stock_subscriptions")
    .select("id, oracle_id, card_name, email")
    .is("notified_at", null)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[stock-alerts] queue load failed", error);
    return res.status(500).json({ ok: false });
  }

  let sent = 0;
  let failed = 0;
  let stillOut = 0;

  for (const row of rows ?? []) {
    try {
      const { count } = await db
        .from("inventory_items")
        .select("id", { count: "exact", head: true })
        .eq("oracle_id", row.oracle_id)
        .eq("status", "active")
        .gt("quantity", 0);

      if (!count) {
        stillOut += 1;
        continue; // leave pending — still out of stock, try again next run
      }

      const productUrl = `${siteUrl()}/shop/card/${slugifyCardName(row.card_name)}`;
      const data = {
        cardName: row.card_name,
        productUrl,
        siteUrl: siteUrl(),
        logoUrl: logoUrl(),
        supportEmail: ServerEnv.replyTo(),
      };

      const result = await sendTrackedEmail({
        emailType: "card_back_in_stock",
        idempotencyKey: `card-stock-${row.id}`,
        to: row.email,
        from: ServerEnv.fromMarketing(),
        replyTo: ServerEnv.replyTo(),
        subject: `${row.card_name} is back in stock — Geega Games`,
        react: CardBackInStock(data),
        text: cardBackInStockText(data),
      });

      if (result.status === "failed") {
        // Leave notified_at null so a transient send failure retries next run.
        failed += 1;
      } else {
        await db
          .from("card_stock_subscriptions")
          .update({ notified_at: new Date().toISOString() })
          .eq("id", row.id);
        sent += 1;
      }
    } catch (err) {
      console.error("[stock-alerts] send failed", row.id, err);
      failed += 1;
    }
  }

  return res.status(200).json({
    ok: true,
    processed: (rows ?? []).length,
    sent,
    failed,
    stillOut,
  });
}
