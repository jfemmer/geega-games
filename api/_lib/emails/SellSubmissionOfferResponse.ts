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

// Confirms the seller's own response to a sent offer, submitted via the
// public /sell/offer page (see api/sell/respond-to-offer.ts, the only
// caller). "accepted" is deliberately NOT a variant here — accepting also
// flips status to 'accepted', which already sends its own, more detailed
// email (PayPal/next-steps copy) via sendSellSubmissionStatusUpdate; adding
// a second "accepted" template here would just be two copies of the same
// message that could drift out of sync.
export type SellOfferResponseKind = "declined" | "countered";

export type SellSubmissionOfferResponseEmailData = {
  kind: SellOfferResponseKind;
  firstName: string | null;
  referenceNumber: string;
  offerValueCents: number;
  /** Only meaningful when kind === "countered". */
  counterOfferCents?: number | null;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const COPY: Record<
  SellOfferResponseKind,
  {
    subject: (d: SellSubmissionOfferResponseEmailData) => string;
    heading: string;
    body: (d: SellSubmissionOfferResponseEmailData) => string;
  }
> = {
  declined: {
    subject: (d) => `You declined our offer — ${d.referenceNumber}`,
    heading: "Thanks for letting us know",
    body: (d) =>
      `You declined our offer of ${money(d.offerValueCents)} for your collection. No hard feelings — we're happy to take a look at future collections anytime.`,
  },
  countered: {
    subject: (d) => `We received your counter-offer — ${d.referenceNumber}`,
    heading: "We received your counter-offer",
    body: (d) =>
      `You countered our offer of ${money(d.offerValueCents)} with ${money(
        d.counterOfferCents ?? 0,
      )}. We'll review it and follow up soon — no action needed from you right now.`,
  },
};

export function SellSubmissionOfferResponse(data: SellSubmissionOfferResponseEmailData) {
  const copy = COPY[data.kind];
  const greeting = data.firstName ? `Hi ${data.firstName},` : "Hi there,";

  return h(
    BaseLayout,
    {
      previewText: copy.subject(data),
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine: `You received this because you responded to our offer for submission ${data.referenceNumber}.`,
    },
    h(Heading, { key: "h1", style: h1 }, copy.heading),
    h(Text, { key: "greet", style: p }, greeting),
    h(Text, { key: "body", style: p }, copy.body(data)),
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

export function sellSubmissionOfferResponseSubject(
  d: SellSubmissionOfferResponseEmailData,
): string {
  return COPY[d.kind].subject(d);
}

export function sellSubmissionOfferResponseText(
  d: SellSubmissionOfferResponseEmailData,
): string {
  const copy = COPY[d.kind];
  const greeting = d.firstName ? `Hi ${d.firstName},` : "Hi there,";
  return [
    copy.heading,
    "",
    greeting,
    copy.body(d),
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
