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

// The subset of sell_submission_status transitions worth emailing a seller
// about. "new" and "reviewing" are internal-only starting states and never
// reach this template. "offer_made" is deliberately absent — that transition
// is now only ever reached through the Send Offer action, which sends its
// own dedicated email actually stating the amount (see
// api/_lib/emails/SellSubmissionOffer.ts) rather than this generic notice.
export type NotifiableSellStatus =
  | "needs_more_photos"
  | "needs_in_person_review"
  | "contacted"
  | "accepted"
  | "declined"
  | "completed"
  | "closed";

export type SellSubmissionStatusEmailData = {
  status: NotifiableSellStatus;
  firstName: string | null;
  referenceNumber: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const COPY: Record<
  NotifiableSellStatus,
  { subject: (ref: string) => string; heading: string; body: string }
> = {
  needs_more_photos: {
    subject: (ref) => `We need a few more photos — ${ref}`,
    heading: "We need a few more photos from you",
    body: "To finish reviewing your collection, could you reply to this email with a few additional photos? Clear, well-lit photos of the cards in question help us the most.",
  },
  needs_in_person_review: {
    subject: (ref) => `We'd like to take a closer look — ${ref}`,
    heading: "We'd like to take a closer look in person",
    body: "Based on what you've shared, we'd like to arrange an in-person look before we can make a call on your collection. Reply to this email and we'll coordinate a time.",
  },
  contacted: {
    subject: (ref) => `We're in touch about your submission — ${ref}`,
    heading: "We've reached out about your submission",
    body: "We contacted you using your preferred contact method to discuss your collection. If you haven't heard from us yet, check your spam folder or reply to this email.",
  },
  accepted: {
    subject: (ref) => `Offer accepted — ${ref}`,
    heading: "Offer accepted — thank you!",
    body: "We'll be in touch with next steps to complete the purchase. As a reminder, payment is made via PayPal Goods & Services only, and some collections ship to us for inspection before payment goes out.",
  },
  declined: {
    subject: (ref) => `Update on your submission — ${ref}`,
    heading: "We've declined this submission",
    body: "After review, we won't be moving forward with a purchase this time. Thanks for thinking of Geega Games — we're happy to take a look at future collections.",
  },
  completed: {
    subject: (ref) => `Sale complete — ${ref}`,
    heading: "Sale complete — thank you!",
    body: "Your sale is complete. Thanks for selling to Geega Games — we'd love to work with you again.",
  },
  closed: {
    subject: (ref) => `Your submission has been closed — ${ref}`,
    heading: "This submission has been closed",
    body: "We've closed out this submission without a sale. If that doesn't sound right or you'd like to resubmit, just reply to this email.",
  },
};

export function SellSubmissionStatusUpdate(data: SellSubmissionStatusEmailData) {
  const copy = COPY[data.status];
  const greeting = data.firstName ? `Hi ${data.firstName},` : "Hi there,";

  return h(
    BaseLayout,
    {
      previewText: copy.subject(data.referenceNumber),
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine: `You received this because you have Sell Your Cards notifications enabled for submission ${data.referenceNumber}.`,
    },
    h(Heading, { key: "h1", style: h1 }, copy.heading),
    h(Text, { key: "greet", style: p }, greeting),
    h(Text, { key: "body", style: p }, copy.body),
    h(
      Section,
      { key: "ref", style: refBox },
      h(Text, { key: "l", style: refLabel }, "Reference number"),
      h(Text, { key: "v", style: refValue }, data.referenceNumber),
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "p2", style: p },
      "Questions? Just reply to this email.",
    ),
  );
}

export function sellSubmissionStatusUpdateSubject(d: SellSubmissionStatusEmailData): string {
  return COPY[d.status].subject(d.referenceNumber);
}

export function sellSubmissionStatusUpdateText(d: SellSubmissionStatusEmailData): string {
  const copy = COPY[d.status];
  const greeting = d.firstName ? `Hi ${d.firstName},` : "Hi there,";
  return [
    copy.heading,
    "",
    greeting,
    copy.body,
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
