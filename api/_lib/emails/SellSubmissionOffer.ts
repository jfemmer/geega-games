import * as React from "react";
import { Heading, Hr, Section, Text } from "@react-email/components";
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

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Sent when staff use the "Send Offer" action on a buying lead — the ONLY
// place a real dollar figure is ever communicated to a seller (see
// api/admin/sell-submissions/[id]/send-offer.ts). This replaces relying on
// the generic offer_made status email, which never actually stated a number
// and assumed staff had already told the seller by phone/text/a separate
// email — this is now the one place that claim is actually true.
export type SellSubmissionOfferEmailData = {
  firstName: string | null;
  referenceNumber: string;
  offerValueCents: number;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

export function SellSubmissionOffer(data: SellSubmissionOfferEmailData) {
  const greeting = data.firstName ? `Hi ${data.firstName},` : "Hi there,";

  return h(
    BaseLayout,
    {
      previewText: `We've made you an offer of ${money(data.offerValueCents)} — ${data.referenceNumber}`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine: `You received this because you submitted a collection to Geega Games — reference ${data.referenceNumber}.`,
    },
    h(Heading, { key: "h1", style: h1 }, "Here's our offer for your collection"),
    h(Text, { key: "greet", style: p }, greeting),
    h(
      Text,
      { key: "body", style: p },
      "After reviewing what you submitted, here's what we're able to offer:",
    ),
    h(
      Section,
      { key: "offer", style: offerBox },
      h(Text, { key: "l", style: offerLabel }, "Our offer"),
      h(Text, { key: "v", style: offerValue }, money(data.offerValueCents)),
    ),
    h(
      Text,
      { key: "body2", style: p },
      "Reply to this email to accept, decline, or ask any questions — no rush, and no obligation either way. If you accept, we'll follow up with next steps; payment is made via PayPal Goods & Services only, and some collections ship to us for inspection before payment goes out.",
    ),
    h(
      Section,
      { key: "ref", style: refBox },
      h(Text, { key: "l", style: refLabel }, "Reference number"),
      h(Text, { key: "v", style: refValue }, data.referenceNumber),
    ),
    h(Hr, { key: "hr", style: hr }),
    h(Text, { key: "p2", style: p }, "Questions? Just reply to this email."),
  );
}

export function sellSubmissionOfferSubject(d: SellSubmissionOfferEmailData): string {
  return `We've made you an offer — ${d.referenceNumber}`;
}

export function sellSubmissionOfferText(d: SellSubmissionOfferEmailData): string {
  const greeting = d.firstName ? `Hi ${d.firstName},` : "Hi there,";
  return [
    "Here's our offer for your collection",
    "",
    greeting,
    "After reviewing what you submitted, here's what we're able to offer:",
    "",
    `Offer: ${money(d.offerValueCents)}`,
    "",
    "Reply to this email to accept, decline, or ask any questions — no rush, and no obligation either way. If you accept, we'll follow up with next steps; payment is made via PayPal Goods & Services only, and some collections ship to us for inspection before payment goes out.",
    "",
    `Reference number: ${d.referenceNumber}`,
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
const offerBox: React.CSSProperties = {
  backgroundColor: brand.purpleDeep,
  borderRadius: "12px",
  padding: "16px 18px",
  margin: "8px 0 16px",
  textAlign: "center",
};
const offerLabel: React.CSSProperties = {
  color: "#e7e0f2",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0 0 4px",
};
const offerValue: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "28px",
  fontWeight: 700,
  margin: 0,
};
const refBox: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "12px 14px",
  margin: "8px 0 16px",
};
const refLabel: React.CSSProperties = {
  color: brand.muted,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0 0 2px",
};
const refValue: React.CSSProperties = {
  color: brand.ink,
  fontSize: "14px",
  fontWeight: 600,
  margin: 0,
};
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
