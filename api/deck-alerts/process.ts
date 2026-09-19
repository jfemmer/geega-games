import * as React from "react";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "../_lib/supabaseAdmin.js";
import { sendTrackedEmail } from "../_lib/emailService.js";
import { ServerEnv } from "../_lib/env.js";
import { siteUrl } from "../_lib/assets.js";

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
        react: deckStockAlertElement({
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


function deckStockAlertElement({
  cardName,
  deckNames,
  productUrl,
  siteUrl: publicSiteUrl,
}: {
  cardName: string;
  deckNames: string[];
  productUrl: string;
  siteUrl: string;
}) {
  const decks =
    deckNames.length === 1
      ? deckNames[0]
      : `${deckNames.slice(0, 2).join(", ")}${deckNames.length > 2 ? ` +${deckNames.length - 2} more` : ""}`;

  return React.createElement(
    "html",
    null,
    React.createElement(
      "body",
      {
        style: {
          margin: 0,
          padding: "24px 12px",
          backgroundColor: "#f7f5fa",
          fontFamily: "Arial, Helvetica, sans-serif",
          color: "#160c1d",
        },
      },
      React.createElement(
        "table",
        {
          role: "presentation",
          cellPadding: "0",
          cellSpacing: "0",
          style: {
            width: "100%",
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            border: "1px solid #e7dff0",
            borderRadius: "14px",
          },
        },
        React.createElement(
          "tbody",
          null,
          React.createElement(
            "tr",
            null,
            React.createElement(
              "td",
              { style: { padding: "28px" } },
              React.createElement(
                "p",
                {
                  style: {
                    margin: 0,
                    color: "#7c00e6",
                    fontWeight: 700,
                    fontSize: "12px",
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                  },
                },
                "Deck restock alert",
              ),
              React.createElement(
                "h1",
                {
                  style: {
                    margin: "8px 0 12px",
                    color: "#160c1d",
                    fontSize: "24px",
                    lineHeight: 1.25,
                  },
                },
                `${cardName} is back in stock`,
              ),
              React.createElement(
                "p",
                {
                  style: {
                    margin: "0 0 22px",
                    color: "#5f5667",
                    lineHeight: 1.6,
                    fontSize: "15px",
                  },
                },
                `A card you’re watching for ${deckNames.length > 1 ? "your decks" : "your deck"} `,
                React.createElement("strong", null, decks),
                " is now available at Geega Games.",
              ),
              React.createElement(
                "a",
                {
                  href: productUrl,
                  style: {
                    display: "inline-block",
                    backgroundColor: "#663399",
                    color: "#ffffff",
                    borderRadius: "8px",
                    padding: "12px 18px",
                    textDecoration: "none",
                    fontWeight: 700,
                  },
                },
                "View available card",
              ),
              React.createElement("hr", {
                style: {
                  border: 0,
                  borderTop: "1px solid #eee8f3",
                  margin: "24px 0",
                },
              }),
              React.createElement(
                "p",
                {
                  style: {
                    margin: "0 0 8px",
                    color: "#817888",
                    fontSize: "12px",
                    lineHeight: 1.5,
                  },
                },
                "You’re receiving this because restock alerts are enabled for a saved deck in your Geega Games account. You can change deck notification settings from My Decks.",
              ),
              React.createElement(
                "p",
                { style: { margin: 0, color: "#817888", fontSize: "12px" } },
                publicSiteUrl,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function deckStockAlertText({
  cardName,
  deckNames,
  productUrl,
}: {
  cardName: string;
  deckNames: string[];
  productUrl: string;
}) {
  return [
    `${cardName} is back in stock at Geega Games.`,
    "",
    `You’re watching this card for: ${deckNames.join(", ")}.`,
    "",
    `View available card: ${productUrl}`,
    "",
    "You can change deck restock alerts from My Decks in your Geega Games account.",
  ].join("\n");
}
