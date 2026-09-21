import * as React from "react";
import { Column, Heading, Hr, Link, Row, Section, Text } from "@react-email/components";
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

export type StaffDigestEmailData = {
  dateLabel: string;
  newOrders: number;
  newOrdersRevenueCents: number;
  newLeads: number;
  newSignups: number;
  newSubscribers: number;
  ordersNeedingPacking: number;
  pendingPickups: number;
  lowStockCount: number;
  adminUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function StatRow(label: string, value: string) {
  return h(
    Row,
    { style: { margin: "3px 0" } },
    h(Column, null, h(Text, { style: statLabel }, label)),
    h(Column, { style: { textAlign: "right" } }, h(Text, { style: statValue }, value)),
  );
}

export function StaffDigest(data: StaffDigestEmailData) {
  return h(
    BaseLayout,
    {
      previewText: `Geega Games daily digest — ${data.dateLabel}`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
    },
    h(Heading, { key: "h1", style: h1 }, "Yesterday at Geega Games"),
    h(Text, { key: "date", style: dateText }, data.dateLabel),

    h(Section, { key: "activity", style: sectionBox },
      h(Text, { style: sectionHeading }, "Since yesterday"),
      StatRow("New orders", `${data.newOrders} (${money(data.newOrdersRevenueCents)})`),
      StatRow("New buying leads", String(data.newLeads)),
      StatRow("New accounts", String(data.newSignups)),
      StatRow("Newsletter signups", String(data.newSubscribers)),
    ),

    h(Section, { key: "needs-attention", style: { ...sectionBox, marginTop: "12px" } },
      h(Text, { style: sectionHeading }, "Needs attention right now"),
      StatRow("Orders needing packing", String(data.ordersNeedingPacking)),
      StatRow("Pending pickup requests", String(data.pendingPickups)),
      StatRow("Low-stock cards", String(data.lowStockCount)),
    ),

    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "cta", style: p },
      h(Link, { href: data.adminUrl, style: ctaLink }, "Open the admin dashboard →"),
    ),
  );
}

export function staffDigestText(d: StaffDigestEmailData): string {
  return [
    `Yesterday at Geega Games — ${d.dateLabel}`,
    "",
    "Since yesterday:",
    `  New orders: ${d.newOrders} (${money(d.newOrdersRevenueCents)})`,
    `  New buying leads: ${d.newLeads}`,
    `  New accounts: ${d.newSignups}`,
    `  Newsletter signups: ${d.newSubscribers}`,
    "",
    "Needs attention right now:",
    `  Orders needing packing: ${d.ordersNeedingPacking}`,
    `  Pending pickup requests: ${d.pendingPickups}`,
    `  Low-stock cards: ${d.lowStockCount}`,
    "",
    `Open the admin dashboard: ${d.adminUrl}`,
  ].join("\n");
}

const h1: React.CSSProperties = {
  color: brand.purpleDeep,
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 4px",
};
const dateText: React.CSSProperties = {
  color: brand.muted,
  fontSize: "13px",
  margin: "0 0 16px",
};
const p: React.CSSProperties = {
  color: brand.ink,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
};
const sectionBox: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "12px 14px",
};
const sectionHeading: React.CSSProperties = {
  color: brand.muted,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  margin: "0 0 6px",
  fontWeight: 700,
};
const statLabel: React.CSSProperties = { color: brand.ink, fontSize: "13px", margin: 0 };
const statValue: React.CSSProperties = { color: brand.ink, fontSize: "13px", fontWeight: 600, margin: 0 };
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
const ctaLink: React.CSSProperties = { color: brand.purple, fontWeight: 600, textDecoration: "underline" };
