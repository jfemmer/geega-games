import * as React from "react";
import {
  Column,
  Heading,
  Hr,
  Row,
  Section,
  Text,
} from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Mirrors the columns actually present in public.order_items / public.orders.
export type OrderItemSnapshot = {
  card_name: string;
  set_name: string | null;
  condition: string | null; // NM | LP | MP | HP | DMG
  finish: string | null; // nonfoil | foil | etched | glossy
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
  f && f !== "nonfoil" ? ` · ${f.charAt(0).toUpperCase()}${f.slice(1)}` : "";

export function OrderConfirmation(data: OrderEmailData) {
  const greeting = data.firstName ? `Thanks, ${data.firstName}!` : "Thanks for your order!";
  const orderDate = new Date(data.createdAtISO).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <BaseLayout
      previewText={`Order ${data.orderNumber} confirmed — Geega Games`}
      siteUrl={data.siteUrl}
      logoUrl={data.logoUrl}
      supportEmail={data.supportEmail}
      reasonLine="You received this because you placed an order at Geega Games."
    >
      <Heading style={h1}>{greeting}</Heading>
      <Text style={p}>
        We’ve received your order. Here’s a summary for your records.
      </Text>

      <Section style={metaBox}>
        <Row>
          <Column>
            <Text style={metaLabel}>Order number</Text>
            <Text style={metaValue}>{data.orderNumber}</Text>
          </Column>
          <Column>
            <Text style={metaLabel}>Order date</Text>
            <Text style={metaValue}>{orderDate}</Text>
          </Column>
          <Column>
            <Text style={metaLabel}>Payment</Text>
            <Text style={metaValue}>
              {data.paymentStatus === "paid" ? "Paid" : data.paymentStatus}
            </Text>
          </Column>
        </Row>
      </Section>

      <Hr style={hr} />

      {data.items.map((it, i) => (
        <Row key={i} style={itemRow}>
          <Column style={{ verticalAlign: "top" }}>
            <Text style={itemName}>{it.card_name}</Text>
            <Text style={itemMeta}>
              {[it.set_name, it.condition ? CONDITION_LABELS[it.condition] ?? it.condition : null]
                .filter(Boolean)
                .join(" · ")}
              {finishLabel(it.finish)}
            </Text>
          </Column>
          <Column style={qtyCol}>
            <Text style={itemMeta}>×{it.quantity}</Text>
          </Column>
          <Column style={priceCol}>
            <Text style={itemPrice}>{money(it.line_total_cents)}</Text>
          </Column>
        </Row>
      ))}

      <Hr style={hr} />

      <TotalsRow label="Subtotal" value={money(data.subtotalCents)} />
      {data.discountCents > 0 && (
        <TotalsRow label="Discount" value={`-${money(data.discountCents)}`} />
      )}
      <TotalsRow label="Shipping" value={money(data.shippingCents)} />
      {data.taxCents > 0 && (
        <TotalsRow label="Tax" value={money(data.taxCents)} />
      )}
      <TotalsRow label="Total" value={money(data.totalCents)} strong />

      <Hr style={hr} />

      <Text style={sectionH}>Shipping to</Text>
      <Text style={address}>
        {[
          data.ship.recipient,
          data.ship.line1,
          data.ship.line2,
          [data.ship.city, data.ship.state, data.ship.postalCode]
            .filter(Boolean)
            .join(", "),
          data.ship.country,
        ]
          .filter(Boolean)
          .map((line, idx) => (
            <React.Fragment key={idx}>
              {line}
              <br />
            </React.Fragment>
          ))}
      </Text>

      <Text style={sectionH}>What happens next</Text>
      <Text style={p}>
        We’ll pack your cards with care and email you tracking as soon as your
        order ships. You can reply to this email any time with questions.
      </Text>
    </BaseLayout>
  );
}

function TotalsRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <Row style={{ margin: "2px 0" }}>
      <Column>
        <Text style={strong ? totalStrong : totalLabel}>{label}</Text>
      </Column>
      <Column style={priceCol}>
        <Text style={strong ? totalStrong : totalLabel}>{value}</Text>
      </Column>
    </Row>
  );
}

export function orderConfirmationText(d: OrderEmailData): string {
  const lines = [
    `Order ${d.orderNumber} confirmed — Geega Games`,
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
        `${it.condition ?? ""}${finishLabel(it.finish)} x${it.quantity} — ${money(it.line_total_cents)}`,
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
