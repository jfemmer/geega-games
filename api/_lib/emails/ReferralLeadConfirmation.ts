import * as React from "react";
import { Heading, Hr, Link, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Seller-facing receipt for a Pokémon / One Piece / video game referral.
// Says plainly that the offer comes from Geega Games' buying partner, not
// Geega Games — the same thing the landing page and consent checkbox say.

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

export type ReferralLeadConfirmationData = {
  firstName: string;
  referenceNumber: string;
  categoriesLabel: string;
  preferredContact: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

export function referralLeadConfirmationSubject(d: ReferralLeadConfirmationData): string {
  return `We got your request — ${d.referenceNumber}`;
}

export function ReferralLeadConfirmation(data: ReferralLeadConfirmationData) {
  return h(
    BaseLayout,
    {
      previewText: `We got your request to sell ${data.categoriesLabel}`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine: "You received this because you asked Geega Games to help you sell items.",
    },
    h(Heading, { key: "h1", style: h1 }, "We got your request!"),
    h(
      Text,
      { key: "p1", style: p },
      `Thanks, ${data.firstName}! We're passing the details you sent about your ${data.categoriesLabel} to the buying partner we work with. They'll contact you directly (by ${data.preferredContact.toLowerCase()}, as you asked) to talk about an offer.`,
    ),
    h(
      Section,
      { key: "ref", style: refBox },
      h(Text, { key: "l", style: refLabel }, "Your reference number"),
      h(Text, { key: "v", style: refValue }, data.referenceNumber),
    ),
    h(
      Text,
      { key: "p2", style: p },
      "Sending this request doesn't commit you to anything — you're free to say no to any offer.",
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "p3", style: p },
      "Have Magic: The Gathering cards too? We buy those ourselves — ",
      h(Link, { href: `${data.siteUrl}/sell-my-collection`, style: link }, "sell your Magic cards"),
      ".",
    ),
  );
}

export function referralLeadConfirmationText(d: ReferralLeadConfirmationData): string {
  return [
    "We got your request! — Geega Games",
    "",
    `Thanks, ${d.firstName}! We're passing the details you sent about your ${d.categoriesLabel} to the buying partner we work with. They'll contact you directly (by ${d.preferredContact.toLowerCase()}, as you asked) to talk about an offer.`,
    "",
    `Reference number: ${d.referenceNumber}`,
    "",
    "Sending this request doesn't commit you to anything — you're free to say no to any offer.",
    "",
    `Have Magic: The Gathering cards too? We buy those ourselves: ${d.siteUrl}/sell-my-collection`,
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
const refBox: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "16px 18px",
  margin: "8px 0 16px",
  textAlign: "center",
};
const refLabel: React.CSSProperties = {
  color: brand.muted,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0 0 4px",
};
const refValue: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "22px",
  fontWeight: 700,
  margin: 0,
  letterSpacing: "0.02em",
};
const link: React.CSSProperties = { color: brand.purple, textDecoration: "underline" };
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
