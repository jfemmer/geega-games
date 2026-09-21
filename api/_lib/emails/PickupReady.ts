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

export type PickupReadyEmailData = {
  customerName: string;
  itemCount: number;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

export function PickupReady(data: PickupReadyEmailData) {
  const greeting = data.customerName ? `Hi ${data.customerName},` : "Hi there,";
  return h(
    BaseLayout,
    {
      previewText: "Your pickup order is ready at Geega Games",
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
    },
    h(Heading, { key: "h1", style: h1 }, "Your order is ready for pickup!"),
    h(Text, { key: "greet", style: p }, greeting),
    h(
      Text,
      { key: "body", style: p },
      `Your ${data.itemCount} card${data.itemCount === 1 ? "" : "s"} ${data.itemCount === 1 ? "is" : "are"} pulled and waiting for you at the register.`,
    ),
    h(Hr, { key: "hr", style: hr }),
    h(
      Section,
      { key: "meta", style: metaBox },
      h(Text, { style: metaValue }, "Just let us know your name when you arrive."),
    ),
  );
}

export function pickupReadyText(d: PickupReadyEmailData): string {
  const greeting = d.customerName ? `Hi ${d.customerName},` : "Hi there,";
  return [
    "Your order is ready for pickup!",
    "",
    greeting,
    `Your ${d.itemCount} card${d.itemCount === 1 ? "" : "s"} ${d.itemCount === 1 ? "is" : "are"} pulled and waiting for you at the register.`,
    "",
    "Just let us know your name when you arrive.",
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
const metaBox: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "12px 14px",
  margin: "8px 0 0",
};
const metaValue: React.CSSProperties = {
  color: brand.ink,
  fontSize: "14px",
  fontWeight: 600,
  margin: 0,
};
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
