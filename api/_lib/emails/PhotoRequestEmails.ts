import * as React from "react";
import { Button, Heading, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Shopper-facing emails for card photo requests:
//   * PhotoRequestConfirmation — "we got it, you'll hear back within 24 hours";
//   * PhotoRequestPhotos       — the photos themselves, attached to the email.

const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement =>
  React.createElement(type as React.ElementType, props as Record<string, unknown>, ...children);

export type PhotoRequestCardData = {
  firstName: string;
  referenceNumber: string;
  /** "Sol Ring — Commander Masters #395 · Near Mint · Foil" */
  cardLabel: string;
  /** Absolute link to the card page, if known. */
  cardUrl: string | null;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

export type PhotoRequestConfirmationData = PhotoRequestCardData & { replyHours: number };

export function photoRequestConfirmationSubject(d: PhotoRequestConfirmationData): string {
  return `We're getting your card photo — ${d.referenceNumber}`;
}

export function PhotoRequestConfirmation(d: PhotoRequestConfirmationData) {
  return h(
    BaseLayout,
    {
      previewText: `We'll send a photo of ${d.cardLabel} within ${d.replyHours} hours.`,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: "You received this because you asked Geega Games for a photo of a card.",
    },
    h(Heading, { key: "h1", style: h1 }, "Photo request received"),
    h(
      Text,
      { key: "p1", style: p },
      `Thanks, ${d.firstName}! We'll pull the exact copy you asked about and email you a photo within ${d.replyHours} hours.`,
    ),
    h(
      Section,
      { key: "card", style: box },
      h(Text, { key: "l", style: label }, "Card"),
      h(Text, { key: "v", style: value }, d.cardLabel),
      h(Text, { key: "r", style: refLine }, `Reference ${d.referenceNumber}`),
    ),
    d.cardUrl
      ? h(Button, { key: "btn", href: d.cardUrl, style: button }, "View the card")
      : null,
  );
}

export function photoRequestConfirmationText(d: PhotoRequestConfirmationData): string {
  return [
    "Photo request received — Geega Games",
    "",
    `Thanks, ${d.firstName}! We'll pull the exact copy you asked about and email you a photo within ${d.replyHours} hours.`,
    "",
    `Card: ${d.cardLabel}`,
    `Reference: ${d.referenceNumber}`,
    d.cardUrl ? `View the card: ${d.cardUrl}` : null,
    "",
    `Questions? ${d.supportEmail}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export type PhotoRequestPhotosData = PhotoRequestCardData & {
  photoCount: number;
  /** Optional note from staff, shown as-is. */
  staffMessage: string | null;
};

export function photoRequestPhotosSubject(d: PhotoRequestPhotosData): string {
  return `Your photo of ${d.cardLabel.split(" — ")[0]} — ${d.referenceNumber}`;
}

export function PhotoRequestPhotos(d: PhotoRequestPhotosData) {
  const photos = d.photoCount === 1 ? "a photo" : `${d.photoCount} photos`;
  return h(
    BaseLayout,
    {
      previewText: `Here's ${photos} of the exact card you asked about.`,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: "You received this because you asked Geega Games for a photo of a card.",
    },
    h(Heading, { key: "h1", style: h1 }, "Here's your card"),
    h(
      Text,
      { key: "p1", style: p },
      `Hi ${d.firstName} — ${photos} of the exact copy you asked about ${d.photoCount === 1 ? "is" : "are"} attached to this email.`,
    ),
    d.staffMessage ? h(Text, { key: "msg", style: note }, d.staffMessage) : null,
    h(
      Section,
      { key: "card", style: box },
      h(Text, { key: "l", style: label }, "Card"),
      h(Text, { key: "v", style: value }, d.cardLabel),
      h(Text, { key: "r", style: refLine }, `Reference ${d.referenceNumber}`),
    ),
    h(
      Text,
      { key: "p2", style: p },
      "Cards sell on a first-come basis, so if it's the one you want, grab it before someone else does.",
    ),
    d.cardUrl ? h(Button, { key: "btn", href: d.cardUrl, style: button }, "Buy this card") : null,
  );
}

export function photoRequestPhotosText(d: PhotoRequestPhotosData): string {
  const photos = d.photoCount === 1 ? "a photo" : `${d.photoCount} photos`;
  return [
    "Here's your card — Geega Games",
    "",
    `Hi ${d.firstName} — ${photos} of the exact copy you asked about ${d.photoCount === 1 ? "is" : "are"} attached to this email.`,
    d.staffMessage ? `\n${d.staffMessage}` : null,
    "",
    `Card: ${d.cardLabel}`,
    `Reference: ${d.referenceNumber}`,
    "",
    "Cards sell on a first-come basis, so if it's the one you want, grab it before someone else does.",
    d.cardUrl ? `Buy this card: ${d.cardUrl}` : null,
    "",
    `Questions? ${d.supportEmail}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

const h1: React.CSSProperties = { color: brand.purpleDeep, fontSize: "22px", fontWeight: 600, margin: "0 0 8px" };
const p: React.CSSProperties = { color: brand.ink, fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" };
const note: React.CSSProperties = {
  ...p,
  borderLeft: `3px solid ${brand.gold}`,
  paddingLeft: "12px",
  fontStyle: "italic",
};
const box: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "14px 18px",
  margin: "8px 0 16px",
};
const label: React.CSSProperties = {
  color: brand.muted,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0 0 4px",
};
const value: React.CSSProperties = { color: brand.ink, fontSize: "16px", fontWeight: 600, margin: "0 0 6px" };
const refLine: React.CSSProperties = { color: brand.muted, fontSize: "13px", margin: 0 };
const button: React.CSSProperties = {
  backgroundColor: brand.purple,
  color: "#ffffff",
  borderRadius: "8px",
  padding: "12px 20px",
  fontWeight: 600,
  fontSize: "15px",
  textDecoration: "none",
  display: "inline-block",
};
