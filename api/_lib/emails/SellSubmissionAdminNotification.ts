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

export type SellSubmissionAdminEmailData = {
  referenceNumber: string;
  sellerName: string;
  location: string | null;
  collectionSizeLabel: string | null;
  cardCount: number;
  photoCount: number;
  estimatedValueCents: number | null;
  adminUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function MetaRow(label: string, value: string) {
  return h(
    Row,
    { style: { margin: "4px 0" } },
    h(Column, null, h(Text, { style: metaLabel }, label)),
    h(Column, { style: { textAlign: "right" } }, h(Text, { style: metaValue }, value)),
  );
}

export function SellSubmissionAdminNotification(data: SellSubmissionAdminEmailData) {
  return h(
    BaseLayout,
    {
      previewText: `New buying lead — ${data.referenceNumber}`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
    },
    h(Heading, { key: "h1", style: h1 }, "New buying lead"),
    h(
      Text,
      { key: "p1", style: p },
      `${data.sellerName} submitted a Sell Your Cards request.`,
    ),
    h(
      Section,
      { key: "meta", style: metaBox },
      MetaRow("Reference", data.referenceNumber),
      MetaRow("Seller", data.sellerName),
      data.location ? MetaRow("Location", data.location) : null,
      data.collectionSizeLabel ? MetaRow("Collection size", data.collectionSizeLabel) : null,
      MetaRow("Identified cards", String(data.cardCount)),
      MetaRow("Photos", String(data.photoCount)),
      data.estimatedValueCents != null
        ? MetaRow("Reference estimate", `${money(data.estimatedValueCents)} (internal, not an offer)`)
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

export function sellSubmissionAdminNotificationText(d: SellSubmissionAdminEmailData): string {
  const lines = [
    `New buying lead — ${d.referenceNumber}`,
    "",
    `Seller: ${d.sellerName}`,
    d.location ? `Location: ${d.location}` : "",
    d.collectionSizeLabel ? `Collection size: ${d.collectionSizeLabel}` : "",
    `Identified cards: ${d.cardCount}`,
    `Photos: ${d.photoCount}`,
    d.estimatedValueCents != null
      ? `Reference estimate: ${money(d.estimatedValueCents)} (internal, not an offer)`
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
