import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { sendTrackedEmail } from "../_lib/emailService.js";
import { ServerEnv } from "../_lib/env.js";
import { logoUrl, siteUrl } from "../_lib/assets.js";
import { CardBackInStock, cardBackInStockText } from "../_lib/emails/CardBackInStock.js";
import { HeldCardReleased, heldCardReleasedText } from "../_lib/emails/HeldCardReleased.js";
import { slugifyCardName } from "../../src/store/lib/cardSlug.js";
import { CONDITION_LABELS } from "../../src/store/lib/conditionLabels.js";
import { listingPagePath } from "../../src/seo/catalog.js";

// This worker intentionally accepts GET/POST without customer auth — same
// shape as api/deck-alerts/process.ts. It cannot choose recipients: it only
// drains pending rows a customer explicitly created, and rechecks stock
// itself rather than trusting a trigger, so a request only ever emails once
// the card is actually, currently purchasable. Two queues:
//
//   card_stock_subscriptions  "back in stock" for a card (any copy), from
//                             /api/stock-alerts/subscribe. A card counts as
//                             in stock only when a copy can be bought: copies
//                             held (for a trade, a pickup or a checkout) don't
//                             count (wishlist_card_state).
//   trade_hold_watchers       "released" for one copy a trade was holding,
//                             from /api/stock-alerts/hold-watch
//                             (trade_hold_watchers_due says which are due).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false });
  }

  const db = getSupabaseAdmin();
  const restock = await processRestockQueue(db);
  if (!restock) return res.status(500).json({ ok: false });
  const released = await processHoldWatchers(db);

  return res.status(200).json({ ok: true, ...restock, held: released });
}

type RestockResult = { processed: number; sent: number; failed: number; stillOut: number };

/**
 * One email per request. Asking again after an email re-arms the same row
 * with a new created_at, so it needs its own key: with the bare id it was
 * deduplicated and never sent. (Only pending rows are sent, so a request
 * already emailed under the old key isn't sent again.)
 */
export function restockKey(id: string, createdAt: string | null): string {
  return `card-stock-${id}-${(createdAt && Date.parse(createdAt)) || 0}`;
}

/**
 * After a failed send: let the next run try again. sendTrackedEmail claims
 * the key before sending and keeps a failed claim, so retrying under the
 * same key would be skipped as already sent. Only a failed claim is freed.
 */
async function freeFailedKey(db: SupabaseClient, key: string): Promise<void> {
  const { error } = await db.from("email_deliveries").delete().eq("idempotency_key", key).eq("status", "failed");
  if (error) console.error("[stock-alerts] couldn't free a failed email for retry", key, error.message);
}

/** True when some copy of the card can be bought right now. */
async function cardBuyable(db: SupabaseClient, oracleId: string): Promise<boolean> {
  const { data, error } = await db.rpc("wishlist_card_state", { p_oracle_id: oracleId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { in_stock?: boolean } | null;
  return row?.in_stock === true;
}

async function processRestockQueue(db: SupabaseClient): Promise<RestockResult | null> {
  const { data: rows, error } = await db
    .from("card_stock_subscriptions")
    .select("id, oracle_id, card_name, email, created_at")
    .is("notified_at", null)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("[stock-alerts] queue load failed", error);
    return null;
  }

  let sent = 0;
  let failed = 0;
  let stillOut = 0;

  for (const row of rows ?? []) {
    try {
      if (!(await cardBuyable(db, row.oracle_id))) {
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

      const key = restockKey(row.id, row.created_at);
      const result = await sendTrackedEmail({
        emailType: "card_back_in_stock",
        idempotencyKey: key,
        to: row.email,
        from: ServerEnv.fromMarketing(),
        replyTo: ServerEnv.replyTo(),
        subject: `${row.card_name} is back in stock — Geega Games`,
        react: CardBackInStock(data),
        text: cardBackInStockText(data),
      });

      if (result.status === "failed") {
        // Leave notified_at null so a transient send failure retries next run.
        await freeFailedKey(db, key);
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

  return { processed: (rows ?? []).length, sent, failed, stillOut };
}

type WatcherRow = {
  id: string;
  inventory_item_id: string;
  email: string;
  card_name: string;
  set_name: string | null;
  condition: string | null;
  finish: string | null;
  state: "released" | "gone" | "expired";
  armed_at: string;
};

/** "Dominaria United · Near Mint · Foil" */
export function heldCopyLabel(row: Pick<WatcherRow, "set_name" | "condition" | "finish">): string {
  return [
    row.set_name,
    row.condition ? CONDITION_LABELS[row.condition] ?? row.condition : null,
    row.finish && row.finish !== "nonfoil" ? (row.finish === "etched" ? "Etched foil" : "Foil") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function processHoldWatchers(db: SupabaseClient): Promise<{ sent: number; closed: number; failed: number } | null> {
  const { data, error } = await db.rpc("trade_hold_watchers_due", { p_limit: 50 });
  if (error) {
    // Before its migration runs this queue doesn't exist yet: the restock
    // queue above still works.
    console.error("[stock-alerts] held-copy queue load failed", error);
    return null;
  }

  let sent = 0;
  let closed = 0;
  let failed = 0;
  for (const row of (data ?? []) as WatcherRow[]) {
    try {
      if (row.state !== "released") {
        await db
          .from("trade_hold_watchers")
          .update({ closed_at: new Date().toISOString(), closed_reason: row.state })
          .eq("id", row.id)
          .is("notified_at", null);
        closed += 1;
        continue;
      }

      const emailData = {
        cardName: row.card_name,
        copyLabel: heldCopyLabel(row),
        productUrl: `${siteUrl()}${listingPagePath(slugifyCardName(row.card_name), row.inventory_item_id)}`,
        siteUrl: siteUrl(),
        logoUrl: logoUrl(),
        supportEmail: ServerEnv.replyTo(),
      };
      const key = `trade-hold-released-${row.id}-${Date.parse(row.armed_at) || 0}`;
      const result = await sendTrackedEmail({
        emailType: "trade_hold_released",
        idempotencyKey: key,
        to: row.email,
        from: ServerEnv.fromMarketing(),
        replyTo: ServerEnv.replyTo(),
        subject: `${row.card_name} is available again — Geega Games`,
        react: HeldCardReleased(emailData),
        text: heldCardReleasedText(emailData),
      });
      if (result.status === "failed") {
        await freeFailedKey(db, key);
        failed += 1; // stays pending: retried next run
      } else {
        await db.from("trade_hold_watchers").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
        sent += 1;
      }
    } catch (err) {
      console.error("[stock-alerts] held-copy send failed", row.id, err);
      failed += 1;
    }
  }
  return { sent, closed, failed };
}
