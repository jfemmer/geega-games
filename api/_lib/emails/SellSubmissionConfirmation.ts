import * as React from "react";
import { Heading, Hr, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";
import { STORE_CREDIT_BONUS_PERCENT } from "../../../src/store/lib/sellTypes.js";

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

export type SellSubmissionEmailData = {
  firstName: string | null;
  referenceNumber: string;
  cardCount: number;
  photoCount: number;
  hasCollectionDescription: boolean;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

function summaryLine(d: SellSubmissionEmailData): string {
  const parts: string[] = [];
  if (d.cardCount > 0) {
    parts.push(`${d.cardCount} identified card${d.cardCount === 1 ? "" : "s"}`);
  }
  if (d.photoCount > 0) {
    parts.push(`${d.photoCount} photo${d.photoCount === 1 ? "" : "s"}`);
  }
  if (d.hasCollectionDescription) parts.push("a collection description");
  if (parts.length === 0) return "your submission";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function SellSubmissionConfirmation(data: SellSubmissionEmailData) {
  const greeting = data.firstName ? `Thanks, ${data.firstName}!` : "Thanks!";

  return h(
    BaseLayout,
    {
      previewText: `We received your collection — ${data.referenceNumber}`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine:
        "You received this because you submitted a Sell Your Cards request at Geega Games.",
    },
    h(Heading, { key: "h1", style: h1 }, "We received your collection!"),
    h(
      Text,
      { key: "p1", style: p },
      `${greeting} Thanks for giving Geega Games the opportunity to look at your cards. We received ${summaryLine(data)}, and we'll personally review it and get in touch using your preferred contact method.`,
    ),
    h(
      Section,
      { key: "ref", style: refBox },
      h(Text, { key: "l", style: refLabel }, "Your reference number"),
      h(Text, { key: "v", style: refValue }, data.referenceNumber),
      h(
        Text,
        { key: "hint", style: refHint },
        "Save this for your records — mention it if you contact us with questions.",
      ),
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "p2", style: p },
      "Submitting this form does not guarantee an offer or purchase. We review every submission individually — condition, demand, and the overall collection all factor in — and we'll reach out with next steps or questions.",
    ),
    h(
      Text,
      { key: "p3", style: p },
      `If we agree on a purchase and you're shipping to us, pack cards in sleeves/toploaders and a sturdy box or reinforced mailer with no empty space — never a plain envelope. We pay via PayPal Goods & Services (never Friends & Family) or, if you prefer, in store credit worth ${STORE_CREDIT_BONUS_PERCENT}% more. For some collections we may ask you to ship first so we can verify condition and authenticity before payment goes out.`,
    ),
  );
}

export function sellSubmissionConfirmationText(d: SellSubmissionEmailData): string {
  const greeting = d.firstName ? `Thanks, ${d.firstName}!` : "Thanks!";
  return [
    "We received your collection! — Geega Games",
    "",
    `${greeting} Thanks for giving Geega Games the opportunity to look at your cards.`,
    `We received ${summaryLine(d)}, and we'll personally review it and get in touch using your preferred contact method.`,
    "",
    `Reference number: ${d.referenceNumber}`,
    "Save this for your records.",
    "",
    "Submitting this form does not guarantee an offer or purchase. We review every submission individually.",
    "",
    `If we agree on a purchase and you're shipping to us, pack cards in sleeves/toploaders and a sturdy box or reinforced mailer with no empty space -- never a plain envelope. We pay via PayPal Goods & Services (never Friends & Family) or, if you prefer, in store credit worth ${STORE_CREDIT_BONUS_PERCENT}% more. For some collections we may ask you to ship first so we can verify condition and authenticity before payment goes out.`,
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
  margin: "0 0 4px",
  letterSpacing: "0.02em",
};
const refHint: React.CSSProperties = {
  color: brand.muted,
  fontSize: "12px",
  margin: 0,
};
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
