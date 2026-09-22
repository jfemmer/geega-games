import * as React from "react";
import { Column, Heading, Hr, Link, Row, Section, Text } from "@react-email/components";
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

// Tells staff a seller responded to a sent offer via the public /sell/offer
// page — see api/sell/respond-to-offer.ts, the only caller. Unlike a status
// change staff make themselves in the admin dashboard (which needs no
// notification — they already know), this is the one status/response
// transition an outside actor (the seller) can trigger on their own, so
// staff have no other way to find out it happened.
export type SellSubmissionOfferResponseKind = "accepted" | "declined" | "countered";

export type SellSubmissionOfferResponseAdminEmailData = {
  response: SellSubmissionOfferResponseKind;
  referenceNumber: string;
  sellerName: string;
  offerValueCents: number;
  /** Only set when response === "countered". */
  counterOfferCents: number | null;
  adminUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const COPY: Record<
  SellSubmissionOfferResponseKind,
  { subject: (ref: string) => string; heading: string }
> = {
  accepted: {
    subject: (ref) => `Seller accepted your offer — ${ref}`,
    heading: "Seller accepted your offer",
  },
  declined: {
    subject: (ref) => `Seller declined your offer — ${ref}`,
    heading: "Seller declined your offer",
  },
  countered: {
    subject: (ref) => `Seller countered your offer — ${ref}`,
    heading: "Seller sent a counter-offer",
  },
};

function MetaRow(label: string, value: string) {
  return h(
    Row,
    { style: { margin: "4px 0" } },
    h(Column, null, h(Text, { style: metaLabel }, label)),
    h(Column, { style: { textAlign: "right" } }, h(Text, { style: metaValue }, value)),
  );
}

export function SellSubmissionOfferResponseAdminNotification(
  data: SellSubmissionOfferResponseAdminEmailData,
) {
  const copy = COPY[data.response];
  return h(
    BaseLayout,
    {
      previewText: copy.subject(data.referenceNumber),
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
    },
    h(Heading, { key: "h1", style: h1 }, copy.heading),
    h(
      Text,
      { key: "p1", style: p },
      `${data.sellerName} responded to your offer for submission ${data.referenceNumber}.`,
    ),
    h(
      Section,
      { key: "meta", style: metaBox },
      MetaRow("Reference", data.referenceNumber),
      MetaRow("Seller", data.sellerName),
      MetaRow("Your offer", money(data.offerValueCents)),
      data.response === "countered" && data.counterOfferCents != null
        ? MetaRow("Seller's counter", money(data.counterOfferCents))
        : null,
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "p2", style: p },
      h(Link, { href: data.adminUrl, style: ctaLink }, "Open this lead in the admin dashboard →"),
    ),
  );
}

export function sellSubmissionOfferResponseAdminSubject(
  d: SellSubmissionOfferResponseAdminEmailData,
): string {
  return COPY[d.response].subject(d.referenceNumber);
}

export function sellSubmissionOfferResponseAdminText(
  d: SellSubmissionOfferResponseAdminEmailData,
): string {
  const lines = [
    `${COPY[d.response].heading} — ${d.referenceNumber}`,
    "",
    `Seller: ${d.sellerName}`,
    `Your offer: ${money(d.offerValueCents)}`,
    d.response === "countered" && d.counterOfferCents != null
      ? `Seller's counter: ${money(d.counterOfferCents)}`
      : "",
    "",
    `Open in admin: ${d.adminUrl}`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

const h1: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 8px",
};
const p: React.CSSProperties = {
  color: brand.ink,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};
const metaBox: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "12px 14px",
  margin: "8px 0 0",
};
const metaLabel: React.CSSProperties = {
  color: brand.muted,
  fontSize: "13px",
  margin: 0,
};
const metaValue: React.CSSProperties = {
  color: brand.ink,
  fontSize: "13px",
  fontWeight: 600,
  margin: 0,
};
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
const ctaLink: React.CSSProperties = {
  color: brand.purple,
  fontWeight: 600,
  textDecoration: "underline",
};
