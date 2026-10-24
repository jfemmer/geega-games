import * as React from "react";
import { Button, Column, Heading, Hr, Link, Row, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";
import { TRADE_PRICING_NOTE, tradeBalanceLabel } from "../../../src/store/lib/trades.js";

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

// Sent from Admin → Trade Evaluator after a trade is confirmed (see
// api/_lib/tradeEmails.ts): the trade's totals, and the link to every card
// and price on it.
export type TradeSummaryEmailData = {
  customerName: string;
  tradeNumber: number;
  creditPercent: number;
  theirTcgLowCents: number;
  creditCents: number;
  yourCardsCents: number;
  balanceCents: number;
  /** The customer's page with the full breakdown (/trade?t=…). */
  tradeUrl: string;
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The bottom line, from the customer's side: "You pay", "Trade credit left for you", or an even trade. */
export function tradeBalanceLine(balanceCents: number): { label: string; value: string } {
  return { label: tradeBalanceLabel(balanceCents), value: money(Math.abs(balanceCents)) };
}

const HOW_PRICED = TRADE_PRICING_NOTE;

function greeting(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hi there,";
}

/** A label and its amount on one line: a table row, which every mail app lays out the same. */
function TotalsRow(label: string, value: string, strong = false) {
  return h(
    Row,
    { key: label, style: { margin: "2px 0" } },
    h(Column, null, h(Text, { style: strong ? strongLabel : rowLabel }, label)),
    h(Column, { style: amountCol }, h(Text, { style: strong ? strongValue : rowValue }, value)),
  );
}

export function TradeSummary(data: TradeSummaryEmailData) {
  const balance = tradeBalanceLine(data.balanceCents);
  const rows: [string, string][] = [
    ["Your cards at TCG low", money(data.theirTcgLowCents)],
    [`Trade credit at ${data.creditPercent}%`, money(data.creditCents)],
    ["Our cards at our regular price", money(data.yourCardsCents)],
  ];
  return h(
    BaseLayout,
    {
      previewText: `Trade #${data.tradeNumber}: ${balance.label.toLowerCase()} ${balance.value}`,
      siteUrl: data.siteUrl,
      logoUrl: data.logoUrl,
      supportEmail: data.supportEmail,
      reasonLine: `You received this because you made a trade with Geega Games (trade #${data.tradeNumber}).`,
    },
    h(Heading, { key: "h1", style: h1 }, `Your trade with Geega Games`),
    h(Text, { key: "greet", style: p }, greeting(data.customerName)),
    h(
      Text,
      { key: "intro", style: p },
      `Thanks for trading with us. Here's trade #${data.tradeNumber} at a glance; the link below shows every card and price on it.`,
    ),
    h(
      Section,
      { key: "totals", style: box },
      ...rows.map(([label, value]) => TotalsRow(label, value)),
      h(Hr, { key: "hr", style: boxRule }),
      TotalsRow(balance.label, balance.value, true),
    ),
    h(
      Section,
      { key: "cta", style: { textAlign: "center", margin: "4px 0 16px" } },
      h(Button, { href: data.tradeUrl, style: button }, "See every card and price"),
    ),
    h(Text, { key: "how", style: small }, HOW_PRICED),
    h(Hr, { key: "hr", style: hr }),
    h(
      Text,
      { key: "link", style: small },
      "Or paste this link into your browser:",
      h("br", { key: "br" }),
      h(Link, { key: "a", href: data.tradeUrl, style: linkStyle }, data.tradeUrl),
    ),
  );
}

export function tradeSummarySubject(d: TradeSummaryEmailData): string {
  return `Your trade with Geega Games (#${d.tradeNumber})`;
}

export function tradeSummaryText(d: TradeSummaryEmailData): string {
  const balance = tradeBalanceLine(d.balanceCents);
  return [
    "Your trade with Geega Games",
    "",
    greeting(d.customerName),
    `Thanks for trading with us. Here's trade #${d.tradeNumber} at a glance; the link below shows every card and price on it.`,
    "",
    `Your cards at TCG low: ${money(d.theirTcgLowCents)}`,
    `Trade credit at ${d.creditPercent}%: ${money(d.creditCents)}`,
    `Our cards at our regular price: ${money(d.yourCardsCents)}`,
    `${balance.label}: ${balance.value}`,
    "",
    `Every card and price: ${d.tradeUrl}`,
    "",
    HOW_PRICED,
    "",
    `Questions? ${d.supportEmail}`,
  ].join("\n");
}

const h1: React.CSSProperties = { color: brand.purpleDeep, fontSize: "22px", fontWeight: 600, margin: "0 0 8px" };
const p: React.CSSProperties = { color: brand.ink, fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" };
const box: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "12px",
  padding: "14px 18px",
  margin: "4px 0 18px",
};
const amountCol: React.CSSProperties = { textAlign: "right", width: "40%" };
const rowLabel: React.CSSProperties = { color: brand.muted, fontSize: "14px", lineHeight: "22px", margin: 0 };
const rowValue: React.CSSProperties = { color: brand.ink, fontSize: "14px", lineHeight: "22px", fontWeight: 600, margin: 0 };
const boxRule: React.CSSProperties = { borderColor: brand.line, margin: "10px 0" };
const strongLabel: React.CSSProperties = { color: brand.ink, fontSize: "16px", lineHeight: "24px", fontWeight: 600, margin: 0 };
const strongValue: React.CSSProperties = { color: brand.purpleDeep, fontSize: "18px", lineHeight: "24px", fontWeight: 700, margin: 0 };
const button: React.CSSProperties = {
  backgroundColor: brand.purple,
  color: "#ffffff",
  borderRadius: "999px",
  padding: "12px 22px",
  fontSize: "15px",
  fontWeight: 600,
  textDecoration: "none",
};
const small: React.CSSProperties = { color: brand.muted, fontSize: "13px", lineHeight: "20px", margin: "0 0 12px" };
const hr: React.CSSProperties = { borderColor: brand.line, margin: "16px 0" };
const linkStyle: React.CSSProperties = { color: brand.purple, wordBreak: "break-all" };
