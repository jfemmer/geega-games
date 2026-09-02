import * as React from "react";
import { Button, Heading, Link, Text } from "@react-email/components";
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
      previewText: "Confirm your email to get the Geega Games launch notice.",
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
      "Thanks for your interest in Geega Games. Confirm this address and we\u2019ll email you the moment the shop \u2014 and checkout \u2014 go live.",
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
      { style: small },
      `This link expires in ${expiresInHours} hours. If you didn\u2019t sign up, you can safely ignore this email \u2014 nothing will be sent.`,
    ),
  );
}

export function confirmSubscriptionText(p: ConfirmSubscriptionProps): string {
  return [
    "Confirm your email \u2014 Geega Games",
    "",
    "Thanks for your interest in Geega Games. Confirm this address and we'll",
    "email you the moment the shop and checkout go live.",
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
const link: React.CSSProperties = {
  color: brand.purple,
  textDecoration: "underline",
};