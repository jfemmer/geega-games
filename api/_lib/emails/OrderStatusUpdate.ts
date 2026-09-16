import * as React from "react";
import { Heading, Hr, Link, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";
import { trackingUrlFor, carrierLabel } from "../../../src/store/lib/tracking.js";

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

// The subset of order_status transitions that are worth emailing a customer
// about. Internal-only stages (pending_payment, packing, ready_to_ship) never
// reach this template — see sendOrderStatusEmail's NOTIFIABLE_STATUSES.
export type NotifiableOrderStatus = "shipped" | "delivered" | "cancelled" | "refunded";

export type OrderStatusEmailData = {
  status: NotifiableOrderStatus;
  orderNumber: string;
  firstName: string | null;
  isPwe: boolean;
  trackingCarrier: string | null;
  trackingNumber: string | null;
  orderUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const COPY: Record<
  NotifiableOrderStatus,
  { subject: (orderNumber: string) => string; heading: string; body: string }
> = {
  shipped: {
    subject: (n) => `Your order ${n} has shipped`,
    heading: "Your order has shipped!",
    body: "Your cards are on their way to you.",
  },
  delivered: {
    subject: (n) => `Your order ${n} has been delivered`,
    heading: "Your order has been delivered!",
    body: "Your carrier marked this order as delivered. We hope you love your cards — reply to this email if anything looks off.",
  },
  cancelled: {
    subject: (n) => `Your order ${n} has been cancelled`,
    heading: "Your order has been cancelled.",
    body: "If you were charged, any payment will be refunded to your original payment method. Reply to this email with any questions.",
  },
  refunded: {
    subject: (n) => `Your order ${n} has been refunded`,
    heading: "Your order has been refunded.",
    body: "Your refund has been issued to your original payment method. It may take a few business days to appear.",
  },
};

export function OrderStatusUpdate(data: OrderStatusEmailData) {
  const copy = COPY[data.status];
  const greeting = data.firstName ? `Hi ${data.firstName},` : "Hi there,";
  const trackingUrl = trackingUrlFor(data.trackingCarrier, data.trackingNumber);

  const children: React.ReactNode[] = [
    h(Heading, { key: "h1", style: h1 }, copy.heading),
    h(Text, { key: "greet", style: p }, greeting),
    h(Text, { key: "body", style: p }, copy.body),
  ];

  if (data.status === "shipped") {
    if (data.isPwe) {
      children.push(
        h(
          Section,
          { key: "pwe", style: metaBox },
          h(
            Text,
            { style: metaValue },
            "This order shipped via Plain White Envelope, which does not include tracking.",
          ),
        ),
      );
    } else if (data.trackingNumber) {
      children.push(
        h(
          Section,
          { key: "track", style: metaBox },
          h(Text, { style: metaLabel }, "Carrier"),
          h(Text, { style: metaValue }, carrierLabel(data.trackingCarrier)),
          h(Text, { key: "tn", style: { ...metaLabel, marginTop: "8px" } }, "Tracking number"),
          h(
            Text,
            { style: metaValue },
            trackingUrl
              ? h(Link, { href: trackingUrl, style: link }, data.trackingNumber)
              : data.trackingNumber,
          ),
        ),
      );
    }
  }

  children.push(
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "cta", style: p },
      "You can view full order details any time at ",
      h(Link, { href: data.orderUrl, style: link }, "your order page"),
      ".",
    ),
  );

  return h(
    BaseLayout,
    {
      previewText: copy.subject(data.orderNumber),
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine: `You received this because you have order & shipping notifications enabled for order ${data.orderNumber}.`,
    },
    ...children,
  );
}

export function orderStatusUpdateSubject(data: OrderStatusEmailData): string {
  return COPY[data.status].subject(data.orderNumber);
}

export function orderStatusUpdateText(d: OrderStatusEmailData): string {
  const copy = COPY[d.status];
  const greeting = d.firstName ? `Hi ${d.firstName},` : "Hi there,";
  const trackingUrl = trackingUrlFor(d.trackingCarrier, d.trackingNumber);
  const lines = [copy.heading, "", greeting, copy.body, ""];
  if (d.status === "shipped") {
    if (d.isPwe) {
      lines.push("This order shipped via Plain White Envelope, which does not include tracking.", "");
    } else if (d.trackingNumber) {
      lines.push(`Carrier: ${carrierLabel(d.trackingCarrier)}`);
      lines.push(`Tracking number: ${d.trackingNumber}`);
      if (trackingUrl) lines.push(`Track: ${trackingUrl}`);
      lines.push("");
    }
  }
  lines.push(`Order details: ${d.orderUrl}`, "", `Questions? ${d.supportEmail}`);
  return lines.join("\n");
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
  margin: "8px 0 16px",
};
const metaLabel: React.CSSProperties = {
  color: brand.muted,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0 0 2px",
};
const metaValue: React.CSSProperties = {
  color: brand.ink,
  fontSize: "14px",
  fontWeight: 600,
  margin: 0,
};
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
const link: React.CSSProperties = { color: brand.purple, textDecoration: "underline" };
