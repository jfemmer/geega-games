import * as React from "react";
import { Button, Heading, Link, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// The first email a new subscriber gets: confirm the address (double opt-in).
// It repeats what the signup box promised (src/SignupForm.tsx) and what the
// welcome email says (SubscriptionConfirmed.ts). Change them together.

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

export type ConfirmSubscriptionProps = {
  confirmUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
  expiresInHours: number;
};

export function ConfirmSubscription({
  confirmUrl,
  siteUrl,
  logoUrl,
  supportEmail,
  expiresInHours,
}: ConfirmSubscriptionProps) {
  return h(
    BaseLayout,
    {
      previewText: "One click to join the Geega Games email list.",
      siteUrl,
      logoUrl,
      supportEmail,
      reasonLine:
        "You received this because this address was entered at Geega Games.",
    },
    h(Heading, { style: h1 }, "Confirm your email"),
    h(
      Text,
      { style: p },
      "Thanks for joining the Geega Games email list. Confirm this address and we\u2019ll email you about new arrivals, discounts and the occasional crazy deal.",
    ),
    h(Button, { href: confirmUrl, style: button }, "Confirm my email"),
    h(
      Text,
      { style: small },
      "Or paste this link into your browser:",
      h("br", null),
      h(Link, { href: confirmUrl, style: link }, confirmUrl),
    ),
    h(
      Text,
      { style: note },
      `This link expires in ${expiresInHours} hours. If you didn\u2019t sign up, you can safely ignore this email \u2014 nothing will be sent.`,
    ),
  );
}

export function confirmSubscriptionText(p: ConfirmSubscriptionProps): string {
  return [
    "Confirm your email \u2014 Geega Games",
    "",
    "Thanks for joining the Geega Games email list. Confirm this address and",
    "we'll email you about new arrivals, discounts and the occasional crazy deal.",
    "",
    "Confirm your email:",
    p.confirmUrl,
    "",
    `This link expires in ${p.expiresInHours} hours. If you didn't sign up, ignore this email.`,
    "",
    `Questions? ${p.supportEmail}`,
    "You received this because this address was entered at Geega Games.",
  ].join("\n");
}

const h1: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "22px",
  fontWeight: 600,
  margin: "0 0 12px",
};
const p: React.CSSProperties = {
  color: brand.ink,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 20px",
};
const button: React.CSSProperties = {
  backgroundColor: brand.purple,
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  borderRadius: "10px",
  padding: "12px 22px",
  textDecoration: "none",
  display: "inline-block",
};
const small: React.CSSProperties = {
  color: brand.muted,
  fontSize: "13px",
  lineHeight: "20px",
  margin: "20px 0 0",
  wordBreak: "break-all",
};
// Ordinary sentences keep their words whole; only the pasted link above may
// break mid-word (it has to, to fit a phone).
const note: React.CSSProperties = { ...small, wordBreak: "normal" };
const link: React.CSSProperties = {
  color: brand.purple,
  textDecoration: "underline",
};