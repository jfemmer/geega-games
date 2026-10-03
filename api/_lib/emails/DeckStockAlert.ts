import * as React from "react";

// The email a customer gets when a card on one of their saved decks is back
// in stock (sent by api/deck-alerts/process.ts).
//
// This file must stay a plain .ts module built with createElement, like every
// other template here. Vercel's function bundler only follows a ".js" import
// to a ".ts" file, never to a ".tsx" one: as a .tsx this template was left out
// of the deployed function, which then failed to start on every run.
// tests/apiBundling.test.ts guards against that happening again.
const h = (
  type: string,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement => React.createElement(type, props, ...children);

export type DeckStockAlertEmailData = {
  cardName: string;
  deckNames: string[];
  productUrl: string;
  siteUrl: string;
};

export function DeckStockAlert({ cardName, deckNames, productUrl, siteUrl }: DeckStockAlertEmailData) {
  const decks =
    deckNames.length === 1
      ? deckNames[0]
      : `${deckNames.slice(0, 2).join(", ")}${deckNames.length > 2 ? ` +${deckNames.length - 2} more` : ""}`;

  return h(
    "html",
    null,
    h(
      "head",
      null,
      h("meta", { charSet: "utf-8" }),
      // One string, not two children: React leaves a <title> with several
      // children empty.
      h("title", null, `${cardName} is back in stock`),
    ),
    h(
      "body",
      { style: body },
      h(
        "table",
        { role: "presentation", cellPadding: "0", cellSpacing: "0", style: card },
        h(
          "tbody",
          null,
          h(
            "tr",
            null,
            h(
              "td",
              { style: { padding: "28px" } },
              h("p", { style: eyebrow }, "Deck restock alert"),
              h("h1", { style: h1 }, cardName, " is back in stock"),
              h(
                "p",
                { style: lead },
                "A card you’re watching for ",
                deckNames.length > 1 ? "your decks" : "your deck",
                " ",
                h("strong", null, decks),
                " is now available at Geega Games.",
              ),
              h("a", { href: productUrl, style: button }, "View available card"),
              h("hr", { style: rule }),
              h(
                "p",
                { style: { ...finePrint, margin: "0 0 8px", lineHeight: 1.5 } },
                "You’re receiving this because restock alerts are enabled for a saved deck in your Geega Games account. You can change deck notification settings from My Decks.",
              ),
              h("p", { style: finePrint }, siteUrl),
            ),
          ),
        ),
      ),
    ),
  );
}

export function deckStockAlertText({
  cardName,
  deckNames,
  productUrl,
}: Pick<DeckStockAlertEmailData, "cardName" | "deckNames" | "productUrl">) {
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

const body: React.CSSProperties = {
  margin: 0,
  padding: "24px 12px",
  backgroundColor: "#f7f5fa",
  fontFamily: "Arial, Helvetica, sans-serif",
  color: "#160c1d",
};
const card: React.CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  margin: "0 auto",
  backgroundColor: "#ffffff",
  border: "1px solid #e7dff0",
  borderRadius: "14px",
};
const eyebrow: React.CSSProperties = {
  margin: 0,
  color: "#7c00e6",
  fontWeight: 700,
  fontSize: "12px",
  letterSpacing: "1px",
  textTransform: "uppercase",
};
const h1: React.CSSProperties = {
  margin: "8px 0 12px",
  color: "#160c1d",
  fontSize: "24px",
  lineHeight: 1.25,
};
const lead: React.CSSProperties = {
  margin: "0 0 22px",
  color: "#5f5667",
  lineHeight: 1.6,
  fontSize: "15px",
};
const button: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#663399",
  color: "#ffffff",
  borderRadius: "8px",
  padding: "12px 18px",
  textDecoration: "none",
  fontWeight: 700,
};
const rule: React.CSSProperties = {
  border: 0,
  borderTop: "1px solid #eee8f3",
  margin: "24px 0",
};
const finePrint: React.CSSProperties = {
  margin: 0,
  color: "#817888",
  fontSize: "12px",
};
