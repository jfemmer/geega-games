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

export type CheckoutRecoveryEmailData = {
  firstName: string | null;
  shopUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

export function CheckoutRecovery(data: CheckoutRecoveryEmailData) {
  const greeting = data.firstName ? `Hi ${data.firstName},` : "Hi there,";
  return h(
    BaseLayout,
    {
      previewText: "It looks like your order wasn't completed",
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
    },
    h(Heading, { key: "h1", style: h1 }, "Still want those cards?"),
    h(Text, { key: "greet", style: p }, greeting),
    h(
      Text,
      { key: "body", style: p },
      "It looks like your order didn't go through — no charge was made. If something got in the way, no worries: your cart may still be waiting for you.",
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "cta", style: p },
      h(Link, { href: data.shopUrl, style: link }, "Pick up where you left off →"),
    ),
    h(
      Text,
      { key: "p2", style: p },
      "If you ran into a problem at checkout, just reply to this email and we'll help sort it out.",
    ),
  );
}

export function checkoutRecoveryText(d: CheckoutRecoveryEmailData): string {
  const greeting = d.firstName ? `Hi ${d.firstName},` : "Hi there,";
  return [
    "Still want those cards?",
    "",
    greeting,
    "It looks like your order didn't go through — no charge was made. If something got in the way, no worries: your cart may still be waiting for you.",
    "",
    `Pick up where you left off: ${d.shopUrl}`,
    "",
    "If you ran into a problem at checkout, just reply to this email and we'll help sort it out.",
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
