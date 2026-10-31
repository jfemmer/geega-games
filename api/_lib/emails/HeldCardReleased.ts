import * as React from "react";
import { Heading, Hr, Link, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Sent once to a shopper who asked to hear if a copy held for a trade came
// back (trade_hold_watchers, api/stock-alerts/process.ts).

const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement =>
  React.createElement(type as React.ElementType, props as Record<string, unknown>, ...children);

export type HeldCardReleasedEmailData = {
  cardName: string;
  /** "Dominaria United · Near Mint · Foil", or "" when unknown. */
  copyLabel: string;
  productUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

export function HeldCardReleased(data: HeldCardReleasedEmailData) {
  return h(
    BaseLayout,
    {
      previewText: `${data.cardName} is available again at Geega Games`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine: `You received this because you asked to be told if the ${data.cardName} held for a trade was released.`,
    },
    h(Heading, { key: "h1", style: h1 }, `${data.cardName} is available again`),
    h(
      Text,
      { key: "body", style: p },
      "The copy you were waiting on was held for a trade, and it's been released. It's for sale again, first come, first served.",
    ),
    data.copyLabel ? h(Text, { key: "copy", style: meta }, data.copyLabel) : null,
    h(Hr, { key: "hr", style: hr }),
    h(Text, { key: "cta", style: p }, h(Link, { href: data.productUrl, style: link }, "View and buy this card →")),
  );
}

export function heldCardReleasedText(d: HeldCardReleasedEmailData): string {
  return [
    `${d.cardName} is available again at Geega Games`,
    "",
    "The copy you were waiting on was held for a trade, and it's been released. It's for sale again, first come, first served.",
    ...(d.copyLabel ? ["", d.copyLabel] : []),
    "",
    `View and buy: ${d.productUrl}`,
    "",
    `Questions? ${d.supportEmail}`,
  ].join("\n");
}

const h1: React.CSSProperties = { color: brand.purpleDeep, fontSize: "22px", fontWeight: 600, margin: "0 0 8px" };
const p: React.CSSProperties = { color: brand.ink, fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" };
const meta: React.CSSProperties = { color: brand.ink, fontSize: "14px", lineHeight: "20px", margin: "0 0 16px", fontWeight: 600 };
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
const link: React.CSSProperties = { color: brand.purple, fontWeight: 600, textDecoration: "underline" };
