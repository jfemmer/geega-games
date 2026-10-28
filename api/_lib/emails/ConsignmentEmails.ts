import * as React from "react";
import { Button, Heading, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Consignment agreement emails: the invitation to review and sign, and the
// signed copy (with the PDF attached).

const h = (type: unknown, props?: Record<string, unknown> | null, ...children: React.ReactNode[]): React.ReactElement =>
  React.createElement(type as React.ElementType, props as Record<string, unknown>, ...children);

interface Common {
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
  consignorName: string;
  consignmentLabel: string;
}

export type ConsignmentInviteData = Common & {
  signUrl: string;
  expiresOn: string;
};

export type ConsignmentSignedData = Common & {
  signedAt: string;
  accountUrl: string;
  pdfSha256: string;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

export function ConsignmentInvite(d: ConsignmentInviteData) {
  return h(
    BaseLayout,
    { previewText: `Your consignment agreement ${d.consignmentLabel} is ready to review`, siteUrl: d.siteUrl, logoUrl: d.logoUrl, supportEmail: d.supportEmail },
    h(Heading, { key: "h1", style: h1 }, "Your consignment agreement is ready"),
    h(Text, { key: "g", style: p }, `Hi ${firstName(d.consignorName)},`),
    h(
      Text,
      { key: "b1", style: p },
      `Thanks for consigning your cards with Geega Games. Your agreement (${d.consignmentLabel}) is ready for you to review and sign online.`,
    ),
    h(
      Text,
      { key: "b2", style: p },
      "You'll choose where we may sell your cards (our website, TCGplayer, eBay), decide on extra shipping insurance, and see estimated payouts before you sign. Nothing is listed until you've signed and we've received and checked your cards.",
    ),
    h(Section, { key: "cta", style: { margin: "8px 0 16px" } }, h(Button, { href: d.signUrl, style: button }, "Review and sign")),
    h(
      Text,
      { key: "b3", style: small },
      `Sign in with this email address (or create an account with it) to open the agreement. The link works until ${d.expiresOn}. If you didn't expect this, you can ignore it.`,
    ),
  );
}

export function consignmentInviteText(d: ConsignmentInviteData): string {
  return [
    "Your consignment agreement is ready",
    "",
    `Hi ${firstName(d.consignorName)},`,
    `Thanks for consigning your cards with Geega Games. Your agreement (${d.consignmentLabel}) is ready for you to review and sign online.`,
    "",
    "You'll choose where we may sell your cards (our website, TCGplayer, eBay), decide on extra shipping insurance, and see estimated payouts before you sign. Nothing is listed until you've signed and we've received and checked your cards.",
    "",
    `Review and sign: ${d.signUrl}`,
    "",
    `Sign in with this email address (or create an account with it) to open the agreement. The link works until ${d.expiresOn}.`,
    "",
    `Questions? ${d.supportEmail}`,
  ].join("\n");
}

export function ConsignmentSigned(d: ConsignmentSignedData) {
  return h(
    BaseLayout,
    { previewText: `Your signed consignment agreement ${d.consignmentLabel}`, siteUrl: d.siteUrl, logoUrl: d.logoUrl, supportEmail: d.supportEmail },
    h(Heading, { key: "h1", style: h1 }, "Your signed consignment agreement"),
    h(Text, { key: "g", style: p }, `Hi ${firstName(d.consignorName)},`),
    h(
      Text,
      { key: "b1", style: p },
      `Thanks for signing. Your signed agreement ${d.consignmentLabel} (signed ${d.signedAt}) is attached as a PDF for your records. You can also download it any time from your account.`,
    ),
    h(
      Text,
      { key: "b2", style: p },
      "Next, send us your cards. We'll confirm when they arrive, inspect them, and post the cards we accept to your account before anything is listed.",
    ),
    h(Section, { key: "cta", style: { margin: "8px 0 16px" } }, h(Button, { href: d.accountUrl, style: button }, "View my consignment")),
    h(Text, { key: "fp", style: small }, `The PDF's SHA-256 fingerprint is ${d.pdfSha256}. It matches the copy kept in your account.`),
  );
}

export function consignmentSignedText(d: ConsignmentSignedData): string {
  return [
    "Your signed consignment agreement",
    "",
    `Hi ${firstName(d.consignorName)},`,
    `Thanks for signing. Your signed agreement ${d.consignmentLabel} (signed ${d.signedAt}) is attached as a PDF for your records. You can also download it any time from your account: ${d.accountUrl}`,
    "",
    "Next, send us your cards. We'll confirm when they arrive, inspect them, and post the cards we accept to your account before anything is listed.",
    "",
    `PDF SHA-256: ${d.pdfSha256}`,
    "",
    `Questions? ${d.supportEmail}`,
  ].join("\n");
}

const h1: React.CSSProperties = { color: brand.purpleDeep, fontSize: "22px", fontWeight: 600, margin: "0 0 8px" };
const p: React.CSSProperties = { color: brand.ink, fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" };
const small: React.CSSProperties = { color: brand.muted, fontSize: "13px", lineHeight: "20px", margin: "0 0 12px", wordBreak: "break-all" };
const button: React.CSSProperties = {
  backgroundColor: brand.purple,
  color: "#ffffff",
  borderRadius: "8px",
  padding: "12px 20px",
  fontSize: "15px",
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-block",
};
