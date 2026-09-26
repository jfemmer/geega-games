import * as React from "react";
import { Button, Heading, Link, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// The one-time "would you leave us a Google review?" email, sent a few days
// after a customer has their cards (or, for sellers, after we buy theirs).
// Who gets it, and when, is decided in api/_lib/reviewRequests.ts.
//
// The copy follows Google's review policy and the FTC's rule on consumer
// reviews (16 CFR Part 465):
//   * everyone who qualifies gets the same ask. Nobody is screened first by
//     how happy they are ("review gating"), and the help line comes after
//     the review button, never instead of it;
//   * it asks for an honest review, not a positive one;
//   * no incentive of any kind (no discount, credit or giveaway);
//   * nothing promotional (no products, no codes), so it stays a one-time
//     note about the customer's own purchase or sale.

export type ReviewRequestKind = "shipped_order" | "in_person" | "pickup" | "sell";

export type ReviewRequestEmailData = {
  kind: ReviewRequestKind;
  firstName: string | null;
  /** Order number ("GG-1A2B3C4D") or sell reference; null when there isn't one. */
  reference: string | null;
  /** Google's "write a review" link for the business profile. */
  reviewUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

type Copy = {
  subject: string;
  heading: string;
  intro: (reference: string | null) => string;
  help: string;
  reason: string;
};

const withRef = (reference: string | null) => (reference ? ` (${reference})` : "");

const BUYER_HELP = "Something not right with your cards? Just reply to this email and we'll make it right.";

const COPY: Record<ReviewRequestKind, Copy> = {
  shipped_order: {
    subject: "How did your cards arrive?",
    heading: "How did your cards arrive?",
    intro: (ref) =>
      `Thanks again for your order${withRef(ref)}. We hope your cards showed up exactly as described and well protected.`,
    help: "Something not right with your order? Just reply to this email and we'll make it right.",
    reason: "You're getting this one-time email because you bought cards from Geega Games. We only ask once per order.",
  },
  in_person: {
    subject: "Thanks for stopping by Geega Games",
    heading: "Thanks for stopping by!",
    intro: (ref) => `Thanks for picking up cards from us in person${withRef(ref)}. We hope you're enjoying them.`,
    help: BUYER_HELP,
    reason: "You're getting this one-time email because you bought cards from Geega Games. We only ask once per purchase.",
  },
  pickup: {
    subject: "Thanks for picking up your cards",
    heading: "Thanks for picking up your cards!",
    intro: (ref) => `Thanks for picking up your order${withRef(ref)}. We hope you're enjoying your cards.`,
    help: BUYER_HELP,
    reason: "You're getting this one-time email because you picked up an order from Geega Games. We only ask once per order.",
  },
  sell: {
    subject: "How was selling your cards to Geega Games?",
    heading: "Thanks for selling to us",
    intro: (ref) =>
      `Thanks for selling your cards to Geega Games${withRef(ref)}. We hope the whole process was quick and easy.`,
    help: "Anything we could have done better? Just reply to this email. We read every one.",
    reason: "You're getting this one-time email because you sold cards to Geega Games. We only ask once per sale.",
  },
};

const ASK =
  "Would you take a minute to leave an honest review on Google? It helps other collectors know what to expect from us.";
const ALREADY_REVIEWED = "Already left us a review? Thank you! There's nothing else to do.";
const PREVIEW = "Would you leave an honest review on Google? It only takes a minute.";

const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement =>
  React.createElement(type as React.ElementType, props as Record<string, unknown>, ...children);

function greeting(firstName: string | null): string {
  return firstName ? `Hi ${firstName},` : "Hi there,";
}

export function reviewRequestSubject(d: ReviewRequestEmailData): string {
  return COPY[d.kind].subject;
}

export function ReviewRequest(d: ReviewRequestEmailData) {
  const copy = COPY[d.kind];
  return h(
    BaseLayout,
    {
      previewText: PREVIEW,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: copy.reason,
    },
    h(Heading, { key: "h1", style: h1 }, copy.heading),
    h(Text, { key: "greet", style: p }, greeting(d.firstName)),
    h(Text, { key: "intro", style: p }, copy.intro(d.reference)),
    h(Text, { key: "ask", style: p }, ASK),
    h(Button, { key: "btn", href: d.reviewUrl, style: button }, "Leave a Google review"),
    h(
      Text,
      { key: "fallback", style: small },
      "Button not working? Open ",
      h(Link, { key: "url", href: d.reviewUrl, style: smallLink }, d.reviewUrl),
    ),
    h(Text, { key: "already", style: p }, ALREADY_REVIEWED),
    h(Text, { key: "help", style: p }, copy.help),
    h(Text, { key: "sign", style: p }, "Thank you!", h("br", { key: "br" }), "Geega Games"),
  );
}

export function reviewRequestText(d: ReviewRequestEmailData): string {
  const copy = COPY[d.kind];
  return [
    `${copy.heading} (Geega Games)`,
    "",
    greeting(d.firstName),
    "",
    copy.intro(d.reference),
    "",
    ASK,
    "",
    `Leave a Google review: ${d.reviewUrl}`,
    "",
    ALREADY_REVIEWED,
    "",
    copy.help,
    "",
    "Thank you!",
    "Geega Games",
    "",
    copy.reason,
  ].join("\n");
}

const h1: React.CSSProperties = { color: brand.purpleDeep, fontSize: "22px", fontWeight: 600, margin: "0 0 8px" };
const p: React.CSSProperties = { color: brand.ink, fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" };
const small: React.CSSProperties = {
  color: brand.muted,
  fontSize: "12px",
  lineHeight: "18px",
  margin: "8px 0 18px",
  wordBreak: "break-all",
};
const smallLink: React.CSSProperties = { color: brand.purple, textDecoration: "underline" };
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
