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

// The order updates a customer is emailed about, in the order they happen:
//   packed         staff marked the order ready to ship (all items packed)
//   shipped        a label was bought, or staff marked it shipped
//   delivered      the carrier reported it delivered (tracked orders only)
//   arrival_check  Plain White Envelope has no tracking, so a few mail days
//                  after it ships we check in instead of claiming delivery
//   cancelled / refunded
// Internal-only stages (pending_payment, paid, packing) never reach this
// template. See sendOrderStatusEmail for who gets these and when.
export type OrderEmailKind =
  | "packed"
  | "shipped"
  | "delivered"
  | "arrival_check"
  | "cancelled"
  | "refunded";

/** Earlier name for OrderEmailKind, kept for existing imports. */
export type NotifiableOrderStatus = OrderEmailKind;

export type OrderStatusEmailData = {
  status: OrderEmailKind;
  orderNumber: string;
  firstName: string | null;
  isPwe: boolean;
  trackingCarrier: string | null;
  trackingNumber: string | null;
  /** When it shipped, for the arrival check-in, e.g. "Monday, October 5". */
  shippedOn?: string | null;
  orderUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const COPY: Record<
  OrderEmailKind,
  { subject: (orderNumber: string) => string; heading: string; body: (d: OrderStatusEmailData) => string[] }
> = {
  packed: {
    subject: (n) => `Your order ${n} is packed`,
    heading: "Your order is packed!",
    body: (d) => [
      "Your cards are sleeved, top-loaded and packed, ready to go out.",
      d.isPwe
        ? "It's going by Plain White Envelope, which doesn't have tracking, so we'll email you as soon as it's in the mail."
        : "We'll email you the tracking number as soon as it ships.",
    ],
  },
  shipped: {
    subject: (n) => `Your order ${n} has shipped`,
    heading: "Your order has shipped!",
    body: () => ["Your cards are on their way to you."],
  },
  delivered: {
    subject: (n) => `Your order ${n} has been delivered`,
    heading: "Your order has been delivered!",
    body: () => [
      "Your carrier marked this order as delivered. We hope you love your cards — reply to this email if anything looks off.",
    ],
  },
  arrival_check: {
    subject: (n) => `Has your order ${n} arrived?`,
    heading: "Your order should have arrived",
    body: (d) => [
      `${d.shippedOn ? `We mailed your order by Plain White Envelope on ${d.shippedOn}.` : "We mailed your order by Plain White Envelope."} It doesn't have tracking, so we can't see when it's delivered, but by now it should be with you. We hope you love your cards!`,
      "If it hasn't arrived yet, just reply to this email and we'll help.",
    ],
  },
  cancelled: {
    subject: (n) => `Your order ${n} has been cancelled`,
    heading: "Your order has been cancelled.",
    body: () => [
      "If you were charged, any payment will be refunded to your original payment method. Reply to this email with any questions.",
    ],
  },
  refunded: {
    subject: (n) => `Your order ${n} has been refunded`,
    heading: "Your order has been refunded.",
    body: () => [
      "Your refund has been issued to your original payment method. It may take a few business days to appear.",
    ],
  },
};

const PWE_SHIPPED_NOTE =
  "This order shipped via Plain White Envelope, which does not include tracking. We'll check in after it's had time to arrive.";

/** Carrier and tracking number, shown once there is one: shipped and delivered. */
function showsTracking(d: OrderStatusEmailData): boolean {
  return (d.status === "shipped" || d.status === "delivered") && !d.isPwe && Boolean(d.trackingNumber);
}

export function OrderStatusUpdate(data: OrderStatusEmailData) {
  const copy = COPY[data.status];
  const greeting = data.firstName ? `Hi ${data.firstName},` : "Hi there,";
  const trackingUrl = trackingUrlFor(data.trackingCarrier, data.trackingNumber);

  const children: React.ReactNode[] = [
    h(Heading, { key: "h1", style: h1 }, copy.heading),
    h(Text, { key: "greet", style: p }, greeting),
    ...copy.body(data).map((text, i) => h(Text, { key: `body-${i}`, style: p }, text)),
  ];

  if (data.status === "shipped" && data.isPwe) {
    children.push(
      h(Section, { key: "pwe", style: metaBox }, h(Text, { style: metaValue }, PWE_SHIPPED_NOTE)),
    );
  } else if (showsTracking(data)) {
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
  const lines = [copy.heading, "", greeting, ...copy.body(d).flatMap((text) => [text, ""])];
  if (d.status === "shipped" && d.isPwe) {
    lines.push(PWE_SHIPPED_NOTE, "");
  } else if (showsTracking(d)) {
    lines.push(`Carrier: ${carrierLabel(d.trackingCarrier)}`);
    lines.push(`Tracking number: ${d.trackingNumber}`);
    if (trackingUrl) lines.push(`Track: ${trackingUrl}`);
    lines.push("");
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
