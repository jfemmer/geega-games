import * as React from "react";
import { Column, Heading, Hr, Link, Row, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Staff notification for a Pokémon / One Piece / video game referral lead.
// Written to be forwarded to the buying partner as-is: everything the partner
// needs (what it is, how much, meet or ship, contact details, photo links)
// is in the body, and replyTo is the seller, so "Reply" reaches them directly.

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

export type ReferralLeadAdminEmailData = {
  referenceNumber: string;
  categoriesLabel: string;
  sellerName: string;
  email: string;
  phone: string | null;
  preferredContact: string;
  location: string | null;
  sizeLabel: string | null;
  handoffLabel: string | null;
  description: string;
  photoUrls: string[];
  photoLinkDays: number;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

export function referralLeadAdminSubject(d: ReferralLeadAdminEmailData): string {
  return `New referral lead: ${d.categoriesLabel} — ${d.referenceNumber}`;
}

function MetaRow(label: string, value: string) {
  return h(
    Row,
    { key: label, style: { margin: "4px 0" } },
    h(Column, null, h(Text, { style: metaLabel }, label)),
    h(Column, { style: { textAlign: "right" } }, h(Text, { style: metaValue }, value)),
  );
}

export function ReferralLeadAdminNotification(data: ReferralLeadAdminEmailData) {
  return h(
    BaseLayout,
    {
      previewText: `${data.sellerName} is selling ${data.categoriesLabel}`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
    },
    h(Heading, { key: "h1", style: h1 }, "New referral lead"),
    h(
      Text,
      { key: "p1", style: p },
      `${data.sellerName} is selling ${data.categoriesLabel} and agreed to have their details shared with our buying partner. Forward this email to the partner, or reply to reach the seller.`,
    ),
    h(
      Section,
      { key: "meta", style: metaBox },
      MetaRow("Reference", data.referenceNumber),
      MetaRow("Selling", data.categoriesLabel),
      data.sizeLabel ? MetaRow("Size", data.sizeLabel) : null,
      data.handoffLabel ? MetaRow("Meet up or ship", data.handoffLabel) : null,
      MetaRow("Name", data.sellerName),
      MetaRow("Email", data.email),
      data.phone ? MetaRow("Phone", data.phone) : null,
      MetaRow("Prefers", data.preferredContact),
      data.location ? MetaRow("Location", data.location) : null,
    ),
    h(Text, { key: "dl", style: sectionLabel }, "What they have"),
    h(Text, { key: "desc", style: descBox }, data.description),
    data.photoUrls.length > 0
      ? h(
          Section,
          { key: "photos" },
          h(
            Text,
            { key: "pl", style: sectionLabel },
            `Photos (${data.photoUrls.length}) — links work for ${data.photoLinkDays} days`,
          ),
          ...data.photoUrls.map((url, i) =>
            h(
              Text,
              { key: `ph${i}`, style: photoLine },
              h(Link, { href: url, style: link }, `Photo ${i + 1}`),
            ),
          ),
        )
      : h(Text, { key: "nophotos", style: muted }, "No photos attached."),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "p2", style: muted },
      "Geega Games doesn't buy these categories itself — the buying partner contacts the seller and makes any offer.",
    ),
  );
}

export function referralLeadAdminText(d: ReferralLeadAdminEmailData): string {
  return [
    `New referral lead — ${d.referenceNumber}`,
    "",
    `${d.sellerName} is selling ${d.categoriesLabel} and agreed to have their details shared with our buying partner.`,
    "",
    `Selling: ${d.categoriesLabel}`,
    d.sizeLabel ? `Size: ${d.sizeLabel}` : "",
    d.handoffLabel ? `Meet up or ship: ${d.handoffLabel}` : "",
    `Name: ${d.sellerName}`,
    `Email: ${d.email}`,
    d.phone ? `Phone: ${d.phone}` : "",
    `Prefers: ${d.preferredContact}`,
    d.location ? `Location: ${d.location}` : "",
    "",
    "What they have:",
    d.description,
    "",
    d.photoUrls.length > 0
      ? [`Photos (links work for ${d.photoLinkDays} days):`, ...d.photoUrls].join("\n")
      : "No photos attached.",
  ]
    .filter((line) => line !== "")
    .join("\n");
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
const muted: React.CSSProperties = {
  color: brand.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 8px",
};
const metaBox: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "12px 14px",
  margin: "8px 0 16px",
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
const sectionLabel: React.CSSProperties = {
  color: brand.muted,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0 0 6px",
};
const descBox: React.CSSProperties = {
  color: brand.ink,
  fontSize: "14px",
  lineHeight: "22px",
  whiteSpace: "pre-wrap",
  border: `1px solid ${brand.line}`,
  borderRadius: "10px",
  padding: "12px 14px",
  margin: "0 0 16px",
};
const photoLine: React.CSSProperties = { margin: "0 0 4px", fontSize: "14px" };
const link: React.CSSProperties = { color: brand.purple, textDecoration: "underline" };
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
