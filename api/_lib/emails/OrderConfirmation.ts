import * as React from "react";
import { Column, Heading, Hr, Row, Section, Text } from "@react-email/components";
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

// Mirrors the columns actually present in public.order_items / public.orders.
export type OrderItemSnapshot = {
  card_name: string;
  set_name: string | null;
  condition: string | null;
  finish: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

export type OrderEmailData = {
  orderNumber: string;
  firstName: string | null;
  createdAtISO: string;
  paymentStatus: string;
  items: OrderItemSnapshot[];
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  ship: {
    recipient: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  };
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const CONDITION_LABELS: Record<string, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};
const finishLabel = (f: string | null) =>
  f && f !== "nonfoil" ? ` \u00b7 ${f.charAt(0).toUpperCase()}${f.slice(1)}` : "";

function TotalsRow(label: string, value: string, strong?: boolean) {
  return h(
    Row,
    { style: { margin: "2px 0" } },
    h(Column, null, h(Text, { style: strong ? totalStrong : totalLabel }, label)),
    h(
      Column,
      { style: priceCol },
      h(Text, { style: strong ? totalStrong : totalLabel }, value),
    ),
  );
}

export function OrderConfirmation(data: OrderEmailData) {
  const greeting = data.firstName
    ? `Thanks, ${data.firstName}!`
    : "Thanks for your order!";
  const orderDate = new Date(data.createdAtISO).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const children: React.ReactNode[] = [
    h(Heading, { key: "greet", style: h1 }, greeting),
    h(
      Text,
      { key: "intro", style: p },
      "We\u2019ve received your order. Here\u2019s a summary for your records.",
    ),
    h(
      Section,
      { key: "meta", style: metaBox },
      h(
        Row,
        null,
        h(
          Column,
          null,
          h(Text, { style: metaLabel }, "Order number"),
          h(Text, { style: metaValue }, data.orderNumber),
        ),
        h(
          Column,
          null,
          h(Text, { style: metaLabel }, "Order date"),
          h(Text, { style: metaValue }, orderDate),
        ),
        h(
          Column,
          null,
          h(Text, { style: metaLabel }, "Payment"),
          h(
            Text,
            { style: metaValue },
            data.paymentStatus === "paid" ? "Paid" : data.paymentStatus,
          ),
        ),
      ),
    ),
    h(Hr, { key: "hr1", style: hr }),
    ...data.items.map((it, i) =>
      h(
        Row,
        { key: `item-${i}`, style: itemRow },
        h(
          Column,
          { style: { verticalAlign: "top" } },
          h(Text, { style: itemName }, it.card_name),
          h(
            Text,
            { style: itemMeta },
            [
              it.set_name,
              it.condition
                ? (CONDITION_LABELS[it.condition] ?? it.condition)
                : null,
            ]
              .filter(Boolean)
              .join(" \u00b7 ") + finishLabel(it.finish),
          ),
        ),
        h(Column, { style: qtyCol }, h(Text, { style: itemMeta }, `\u00d7${it.quantity}`)),
        h(
          Column,
          { style: priceCol },
          h(Text, { style: itemPrice }, money(it.line_total_cents)),
        ),
      ),
    ),
    h(Hr, { key: "hr2", style: hr }),
    h("div", { key: "sub" }, TotalsRow("Subtotal", money(data.subtotalCents))),
    data.discountCents > 0
      ? h(
          "div",
          { key: "disc" },
          TotalsRow("Discount", `-${money(data.discountCents)}`),
        )
      : null,
    h("div", { key: "ship" }, TotalsRow("Shipping", money(data.shippingCents))),
    data.taxCents > 0
      ? h("div", { key: "tax" }, TotalsRow("Tax", money(data.taxCents)))
      : null,
    h("div", { key: "tot" }, TotalsRow("Total", money(data.totalCents), true)),
    h(Hr, { key: "hr3", style: hr }),
    h(Text, { key: "shipH", style: sectionH }, "Shipping to"),
    h(
      Text,
      { key: "addr", style: address },
      ...[
        data.ship.recipient,
        data.ship.line1,
        data.ship.line2,
        [data.ship.city, data.ship.state, data.ship.postalCode]
          .filter(Boolean)
          .join(", "),
        data.ship.country,
      ]
        .filter(Boolean)
        .flatMap((line, idx) => [
          h(React.Fragment, { key: `a-${idx}` }, line as string),
          h("br", { key: `br-${idx}` }),
        ]),
    ),
    h(Text, { key: "nextH", style: sectionH }, "What happens next"),
    h(
      Text,
      { key: "next", style: p },
      "We\u2019ll pack your cards with care and email you tracking as soon as your order ships. You can reply to this email any time with questions.",
    ),
  ];

  return h(
    BaseLayout,
    {
      previewText: `Order ${data.orderNumber} confirmed \u2014 Geega Games`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine:
        "You received this because you placed an order at Geega Games.",
    },
    ...children,
  );
}

export function orderConfirmationText(d: OrderEmailData): string {
  const lines = [
    `Order ${d.orderNumber} confirmed \u2014 Geega Games`,
    "",
    d.firstName ? `Thanks, ${d.firstName}!` : "Thanks for your order!",
    "",
    `Order number: ${d.orderNumber}`,
    `Order date: ${new Date(d.createdAtISO).toDateString()}`,
    `Payment: ${d.paymentStatus}`,
    "",
    "Items:",
    ...d.items.map(
      (it) =>
        `  ${it.card_name}${it.set_name ? ` (${it.set_name})` : ""} ` +
        `${it.condition ?? ""}${finishLabel(it.finish)} x${it.quantity} \u2014 ${money(it.line_total_cents)}`,
    ),
    "",
    `Subtotal: ${money(d.subtotalCents)}`,
    d.discountCents > 0 ? `Discount: -${money(d.discountCents)}` : "",
    `Shipping: ${money(d.shippingCents)}`,
    d.taxCents > 0 ? `Tax: ${money(d.taxCents)}` : "",
    `Total: ${money(d.totalCents)}`,
    "",
    "Shipping to:",
    `  ${[d.ship.recipient, d.ship.line1, d.ship.line2].filter(Boolean).join(", ")}`,
    `  ${[d.ship.city, d.ship.state, d.ship.postalCode].filter(Boolean).join(", ")}`,
    `  ${d.ship.country ?? ""}`,
    "",
    `Questions? ${d.supportEmail}`,
  ];
  return lines.filter((l) => l !== "").join("\n");
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
const itemRow: React.CSSProperties = { margin: "8px 0" };
const itemName: React.CSSProperties = {
  color: brand.ink,
  fontSize: "14px",
  fontWeight: 600,
  margin: "0 0 2px",
};
const itemMeta: React.CSSProperties = {
  color: brand.muted,
  fontSize: "13px",
  margin: 0,
};
const itemPrice: React.CSSProperties = {
  color: brand.ink,
  fontSize: "14px",
  fontWeight: 600,
  margin: 0,
  textAlign: "right",
};
const qtyCol: React.CSSProperties = { width: "48px", textAlign: "center" };
const priceCol: React.CSSProperties = { width: "88px", textAlign: "right" };
const totalLabel: React.CSSProperties = {
  color: brand.muted,
  fontSize: "14px",
  margin: 0,
};
const totalStrong: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "16px",
  fontWeight: 700,
  margin: 0,
};
const sectionH: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "13px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "8px 0 4px",
};
const address: React.CSSProperties = {
  color: brand.ink,
  fontSize: "14px",
  lineHeight: "20px",
  margin: "0 0 8px",
};