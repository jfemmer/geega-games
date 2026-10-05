import * as React from "react";
import { Button, Heading, Link, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// The welcome email a subscriber gets once they confirm their address. It
// repeats what the signup box promised (src/SignupForm.tsx): new arrivals,
// discounts and sales, and the occasional crazy deal. Change them together.

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

/** Where the welcome email sends people: the newest cards, and the deals. */
export function subscriberShopLinks(siteUrl: string): { newArrivals: string; deals: string } {
  return {
    newArrivals: `${siteUrl}/shop?sort=newest`,
    deals: `${siteUrl}/shop?deals=1`,
  };
}

export function SubscriptionConfirmed({
  siteUrl,
  logoUrl,
  supportEmail,
  unsubscribeUrl,
}: SubscriptionConfirmedProps) {
  const links = subscriberShopLinks(siteUrl);
  return h(
    BaseLayout,
    {
      previewText:
        "You're on the list \u2014 new arrivals, discounts and crazy deals, by email.",
      siteUrl,
      logoUrl,
      supportEmail,
      reasonLine:
        "You received this because you confirmed your email at Geega Games.",
      footerExtra: h(
        Text,
        { style: unsub },
        "Don\u2019t want these emails? ",
        h("a", { href: unsubscribeUrl, style: unsubLink }, "Unsubscribe"),
        ".",
      ),
    },
    h(Heading, { style: h1 }, "You\u2019re on the list \uD83C\uDF89"),
    h(
      Text,
      { style: p },
      "Your email is confirmed. We\u2019ll email you about new arrivals and restocks, discounts and sales, and the occasional crazy deal \u2014 only when there\u2019s something worth opening.",
    ),
    h(Button, { href: links.newArrivals, style: button }, "See what\u2019s new"),
    h(
      Text,
      { style: alt },
      "Or browse ",
      h(Link, { href: links.deals, style: link }, "Deals & Specials"),
      ".",
    ),
    h(Text, { style: p }, "Thanks for joining. \u2014 The Geega Games team"),
  );
}

export function subscriptionConfirmedText(
  p: SubscriptionConfirmedProps,
): string {
  const links = subscriberShopLinks(p.siteUrl);
  return [
    "You're on the list \u2014 Geega Games",
    "",
    "Your email is confirmed. We'll email you about new arrivals and restocks,",
    "discounts and sales, and the occasional crazy deal \u2014 only when there's",
    "something worth opening.",
    "",
    `See what's new: ${links.newArrivals}`,
    `Deals & Specials: ${links.deals}`,
    "",
    "Thanks for joining. \u2014 The Geega Games team",
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
const alt: React.CSSProperties = {
  color: brand.muted,
  fontSize: "14px",
  lineHeight: "22px",
  margin: "14px 0 20px",
};
const link: React.CSSProperties = {
  color: brand.purple,
  textDecoration: "underline",
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
