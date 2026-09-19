import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

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
  const decks = deckNames.length === 1
    ? deckNames[0]
    : `${deckNames.slice(0, 2).join(", ")}${deckNames.length > 2 ? ` +${deckNames.length - 2} more` : ""}`;

  return (
    <Html>
      <Head />
      <Preview>{cardName} is now available at Geega Games</Preview>
      <Body style={{ backgroundColor: "#f7f5fa", fontFamily: "Arial, sans-serif", padding: "24px 0" }}>
        <Container style={{ maxWidth: "560px", backgroundColor: "#ffffff", borderRadius: "14px", padding: "28px", border: "1px solid #e7dff0" }}>
          <Text style={{ margin: 0, color: "#7c00e6", fontWeight: 700, fontSize: "12px", letterSpacing: "1px", textTransform: "uppercase" }}>
            Deck restock alert
          </Text>
          <Heading style={{ margin: "8px 0 12px", color: "#160c1d", fontSize: "24px" }}>
            {cardName} is back in stock
          </Heading>
          <Text style={{ color: "#5f5667", lineHeight: "1.6", fontSize: "15px" }}>
            A card you’re watching for {deckNames.length > 1 ? "your decks" : "your deck"} <strong>{decks}</strong> is now available at Geega Games.
          </Text>
          <Section style={{ margin: "24px 0" }}>
            <Button
              href={productUrl}
              style={{ backgroundColor: "#663399", color: "#ffffff", borderRadius: "8px", padding: "12px 18px", textDecoration: "none", fontWeight: 700 }}
            >
              View available card
            </Button>
          </Section>
          <Hr style={{ borderColor: "#eee8f3", margin: "24px 0" }} />
          <Text style={{ color: "#817888", fontSize: "12px", lineHeight: "1.5" }}>
            You’re receiving this because restock alerts are enabled for a saved deck in your Geega Games account. You can change deck notification settings from My Decks.
          </Text>
          <Text style={{ color: "#817888", fontSize: "12px" }}>
            {siteUrl}
          </Text>
        </Container>
      </Body>
    </Html>
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
