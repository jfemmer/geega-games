import * as React from "react";
import { Heading, Text } from "@react-email/components";
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

export type SubscriptionConfirmedProps = {
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
  unsubscribeUrl: string;
};

export function SubscriptionConfirmed({
  siteUrl,
  logoUrl,
  supportEmail,
  unsubscribeUrl,
}: SubscriptionConfirmedProps) {
  return h(
    BaseLayout,
    {
      previewText:
        "You're on the list \u2014 we'll email you when Geega Games opens.",
      siteUrl,
      logoUrl,
      supportEmail,
      reasonLine:
        "You received this because you confirmed your email at Geega Games.",
      footerExtra: h(
        Text,
        { style: unsub },
        "Don\u2019t want launch updates? ",
        h("a", { href: unsubscribeUrl, style: unsubLink }, "Unsubscribe"),
        ".",
      ),
    },
    h(Heading, { style: h1 }, "You\u2019re on the list \uD83C\uDF89"),
    h(
      Text,
      { style: p },
      "Your email is confirmed. You\u2019ll receive our store-launch announcement the moment browsing turns into buying \u2014 no spam in between, just the launch.",
    ),
    h(Text, { style: p }, "Thanks for being early. \u2014 The Geega Games team"),
  );
}

export function subscriptionConfirmedText(
  p: SubscriptionConfirmedProps,
): string {
  return [
    "You're on the list \u2014 Geega Games",
    "",
    "Your email is confirmed. You'll receive our store-launch announcement the",
    "moment browsing turns into buying \u2014 no spam in between, just the launch.",
    "",
    "Thanks for being early. \u2014 The Geega Games team",
    "",
    `Unsubscribe: ${p.unsubscribeUrl}`,
    `Questions? ${p.supportEmail}`,
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
  margin: "0 0 16px",
};
const unsub: React.CSSProperties = {
  color: brand.muted,
  fontSize: "12px",
  margin: 0,
};
const unsubLink: React.CSSProperties = {
  color: brand.purple,
  textDecoration: "underline",
};