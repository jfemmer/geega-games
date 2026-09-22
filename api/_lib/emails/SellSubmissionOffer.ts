import * as React from "react";
import { Button, Heading, Hr, Link, Section, Text } from "@react-email/components";
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
  /** Deep link to the public /sell/offer page, ref + email pre-filled — see sellSubmissionEmails.ts. */
  responseUrl: string;
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
      "You can accept, decline, or respond right on our site — no rush, and no obligation either way:",
    ),
    h(
      Section,
      { key: "cta", style: { textAlign: "center", margin: "4px 0 16px" } },
      h(Button, { href: data.responseUrl, style: button }, "Respond to this offer"),
    ),
    h(
      Text,
      { key: "body3", style: p },
      "If you accept, we'll follow up with next steps; payment is made via PayPal Goods & Services only, and some collections ship to us for inspection before payment goes out. Prefer email? Just reply here instead.",
    ),
    h(
      Section,
      { key: "ref", style: refBox },
      h(Text, { key: "l", style: refLabel }, "Reference number"),
      h(Text, { key: "v", style: refValue }, data.referenceNumber),
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "p2", style: small },
      "Or paste this link into your browser:",
      h("br", { key: "br" }),
      h(Link, { key: "link", href: data.responseUrl, style: linkStyle }, data.responseUrl),
    ),
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
    "You can accept, decline, or respond right on our site — no rush, and no obligation either way:",
    d.responseUrl,
    "",
    "If you accept, we'll follow up with next steps; payment is made via PayPal Goods & Services only, and some collections ship to us for inspection before payment goes out. Prefer email? Just reply here instead.",
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
const button: React.CSSProperties = {
  backgroundColor: brand.purple,
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  borderRadius: "10px",
  padding: "12px 22px",
  textDecoration: "none",
  display: "inline-block",
};
const small: React.CSSProperties = {
  color: brand.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: 0,
  wordBreak: "break-all",
};
const linkStyle: React.CSSProperties = {
  color: brand.purple,
  textDecoration: "underline",
};
