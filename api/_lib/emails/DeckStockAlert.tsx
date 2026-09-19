import * as React from "react";

export function DeckStockAlert({
  cardName,
  deckNames,
  productUrl,
  siteUrl,
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

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>{cardName} is back in stock</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: "24px 12px",
          backgroundColor: "#f7f5fa",
          fontFamily: "Arial, Helvetica, sans-serif",
          color: "#160c1d",
        }}
      >
        <table
          role="presentation"
          cellPadding="0"
          cellSpacing="0"
          style={{
            width: "100%",
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            border: "1px solid #e7dff0",
            borderRadius: "14px",
          }}
        >
          <tbody>
            <tr>
              <td style={{ padding: "28px" }}>
                <p
                  style={{
                    margin: 0,
                    color: "#7c00e6",
                    fontWeight: 700,
                    fontSize: "12px",
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                  }}
                >
                  Deck restock alert
                </p>

                <h1
                  style={{
                    margin: "8px 0 12px",
                    color: "#160c1d",
                    fontSize: "24px",
                    lineHeight: 1.25,
                  }}
                >
                  {cardName} is back in stock
                </h1>

                <p
                  style={{
                    margin: "0 0 22px",
                    color: "#5f5667",
                    lineHeight: 1.6,
                    fontSize: "15px",
                  }}
                >
                  A card you’re watching for {deckNames.length > 1 ? "your decks" : "your deck"}{" "}
                  <strong>{decks}</strong> is now available at Geega Games.
                </p>

                <a
                  href={productUrl}
                  style={{
                    display: "inline-block",
                    backgroundColor: "#663399",
                    color: "#ffffff",
                    borderRadius: "8px",
                    padding: "12px 18px",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  View available card
                </a>

                <hr
                  style={{
                    border: 0,
                    borderTop: "1px solid #eee8f3",
                    margin: "24px 0",
                  }}
                />

                <p
                  style={{
                    margin: "0 0 8px",
                    color: "#817888",
                    fontSize: "12px",
                    lineHeight: 1.5,
                  }}
                >
                  You’re receiving this because restock alerts are enabled for a saved deck in your
                  Geega Games account. You can change deck notification settings from My Decks.
                </p>

                <p style={{ margin: 0, color: "#817888", fontSize: "12px" }}>
                  {siteUrl}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export function deckStockAlertText({
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
