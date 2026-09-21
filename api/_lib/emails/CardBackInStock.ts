import * as React from "react";
import { Heading, Hr, Link, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Loosely-typed createElement wrapper: React Email components type `children`
// as required, which the variadic createElement overload does not always satisfy.
const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement =>
  React.createElement(
    type as React.ElementType,
    props as Record<string, unknown>,
    ...children,
  );

export type CardBackInStockEmailData = {
  cardName: string;
  productUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

export function CardBackInStock(data: CardBackInStockEmailData) {
  return h(
    BaseLayout,
    {
      previewText: `${data.cardName} is back in stock at Geega Games`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine: `You received this because you asked to be notified when ${data.cardName} is back in stock.`,
    },
    h(Heading, { key: "h1", style: h1 }, `${data.cardName} is back in stock!`),
    h(
      Text,
      { key: "body", style: p },
      "The card you were waiting on is available again at Geega Games.",
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "cta", style: p },
      h(Link, { href: data.productUrl, style: link }, "View and buy this card →"),
    ),
  );
}

export function cardBackInStockText(d: CardBackInStockEmailData): string {
  return [
    `${d.cardName} is back in stock at Geega Games!`,
    "",
    "The card you were waiting on is available again.",
    "",
    `View and buy: ${d.productUrl}`,
    "",
    `Questions? ${d.supportEmail}`,
  ].join("\n");
}

const h1: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "22px",
  fontWeight: 600,
  margin: "0 0 8px",
};
const p: React.CSSProperties = {
  color: brand.ink,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
const link: React.CSSProperties = { color: brand.purple, fontWeight: 600, textDecoration: "underline" };
