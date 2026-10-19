import * as React from "react";
import { Button, Column, Heading, Hr, Link, Row, Section, Text } from "@react-email/components";
import { BaseLayout, brand } from "./BaseLayout.js";

// Collection sorting emails. Every customer email (request received, quote,
// quote approved, payment receipt, status updates) and the staff alerts share
// one layout, filled in by api/_lib/sortingEmails.ts: a heading, a few
// paragraphs, then any of a details box, an itemized quote, a bulleted
// policy list, a note from staff and a button. One layout keeps the quote —
// the part customers rely on — looking identical everywhere it appears.

const h = (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement =>
  React.createElement(type as React.ElementType, props as Record<string, unknown>, ...children);

export interface SortingEmailRow {
  label: string;
  value: string;
}

export interface SortingEmailQuote {
  /** Itemized lines, amounts already formatted ("$12.50"). */
  lines: SortingEmailRow[];
  totalLabel: string;
  total: string;
  /** Small print under the total. */
  footnote?: string | null;
}

export interface SortingEmailList {
  title: string;
  items: readonly string[];
}

export interface SortingEmailData {
  previewText: string;
  heading: string;
  paragraphs: string[];
  rows?: SortingEmailRow[];
  quote?: SortingEmailQuote | null;
  /** A message from staff, shown as written. */
  note?: string | null;
  /** A postal address, line by line (where to ship the cards). */
  address?: { title: string; lines: string[] } | null;
  lists?: SortingEmailList[];
  button?: { href: string; label: string } | null;
  /** Paragraphs after the button. */
  closing?: string[];
  siteUrl: string;
  logoUrl: string;
  supportEmail: string;
  /** Why the email was sent (customer emails); omitted for staff alerts. */
  reasonLine?: string;
}

function detailRow(row: SortingEmailRow, i: number, strong = false) {
  return h(
    Row,
    { key: `row-${i}`, style: { margin: "2px 0" } },
    h(Column, null, h(Text, { style: strong ? totalLabel : rowLabel }, row.label)),
    h(Column, { style: { textAlign: "right", whiteSpace: "nowrap" } }, h(Text, { style: strong ? totalValue : rowValue }, row.value)),
  );
}

export function SortingEmail(d: SortingEmailData) {
  return h(
    BaseLayout,
    {
      previewText: d.previewText,
      siteUrl: d.siteUrl,
      logoUrl: d.logoUrl,
      supportEmail: d.supportEmail,
      reasonLine: d.reasonLine,
    },
    h(Heading, { key: "h1", style: h1 }, d.heading),
    ...d.paragraphs.map((text, i) => h(Text, { key: `p-${i}`, style: p }, text)),
    d.note ? h(Text, { key: "note", style: note }, d.note) : null,
    d.address
      ? h(
          Section,
          { key: "address", style: box },
          h(Text, { style: listTitle }, d.address.title),
          ...d.address.lines.map((line, i) => h(Text, { key: `addr-${i}`, style: addressLine }, line)),
        )
      : null,
    d.rows && d.rows.length > 0
      ? h(Section, { key: "rows", style: box }, ...d.rows.map((row, i) => detailRow(row, i)))
      : null,
    d.quote
      ? h(
          Section,
          { key: "quote", style: box },
          ...d.quote.lines.map((row, i) => detailRow(row, i)),
          h(Hr, { key: "quote-hr", style: hr }),
          detailRow({ label: d.quote.totalLabel, value: d.quote.total }, 99, true),
          d.quote.footnote ? h(Text, { key: "foot", style: footnote }, d.quote.footnote) : null,
        )
      : null,
    ...(d.lists ?? []).map((list, i) =>
      h(
        Section,
        { key: `list-${i}`, style: { margin: "4px 0 12px" } },
        h(Text, { style: listTitle }, list.title),
        ...list.items.map((item, j) => h(Text, { key: `li-${j}`, style: listItem }, `•  ${item}`)),
      ),
    ),
    d.button
      ? h(
          Section,
          { key: "btn", style: { margin: "8px 0 16px" } },
          h(Button, { href: d.button.href, style: button }, d.button.label),
        )
      : null,
    ...(d.closing ?? []).map((text, i) => h(Text, { key: `c-${i}`, style: p }, text)),
    d.button
      ? h(
          Text,
          { key: "btn-link", style: small },
          "Button not working? Open this link: ",
          h(Link, { href: d.button.href, style: link }, d.button.href),
        )
      : null,
  );
}

/** The same email as plain text. */
export function sortingEmailText(d: SortingEmailData): string {
  const out: string[] = [d.heading, ""];
  for (const text of d.paragraphs) out.push(text, "");
  if (d.note) out.push(d.note, "");
  if (d.address) out.push(d.address.title, ...d.address.lines, "");
  if (d.rows?.length) {
    for (const row of d.rows) out.push(`${row.label}: ${row.value}`);
    out.push("");
  }
  if (d.quote) {
    for (const row of d.quote.lines) out.push(`${row.label}: ${row.value}`);
    out.push(`${d.quote.totalLabel}: ${d.quote.total}`);
    if (d.quote.footnote) out.push(d.quote.footnote);
    out.push("");
  }
  for (const list of d.lists ?? []) {
    out.push(list.title);
    for (const item of list.items) out.push(`- ${item}`);
    out.push("");
  }
  if (d.button) out.push(`${d.button.label}: ${d.button.href}`, "");
  for (const text of d.closing ?? []) out.push(text, "");
  out.push(`Questions? ${d.supportEmail}`);
  return out.join("\n");
}

const h1: React.CSSProperties = { color: brand.purpleDeep, fontSize: "22px", fontWeight: 600, margin: "0 0 8px" };
const p: React.CSSProperties = { color: brand.ink, fontSize: "15px", lineHeight: "24px", margin: "0 0 14px" };
const small: React.CSSProperties = { color: brand.muted, fontSize: "12px", lineHeight: "18px", margin: "8px 0 0" };
const note: React.CSSProperties = {
  ...p,
  borderLeft: `3px solid ${brand.gold}`,
  paddingLeft: "12px",
  fontStyle: "italic",
};
const box: React.CSSProperties = {
  backgroundColor: brand.parchment,
  borderRadius: "10px",
  padding: "12px 16px",
  margin: "4px 0 16px",
};
const rowLabel: React.CSSProperties = { color: brand.muted, fontSize: "14px", margin: 0 };
const rowValue: React.CSSProperties = { color: brand.ink, fontSize: "14px", fontWeight: 600, margin: 0 };
const totalLabel: React.CSSProperties = { color: brand.ink, fontSize: "15px", fontWeight: 700, margin: 0 };
const totalValue: React.CSSProperties = { color: brand.purpleDeep, fontSize: "16px", fontWeight: 700, margin: 0 };
const footnote: React.CSSProperties = { color: brand.muted, fontSize: "12px", lineHeight: "18px", margin: "8px 0 0" };
const hr: React.CSSProperties = { borderColor: brand.line, margin: "8px 0" };
const listTitle: React.CSSProperties = { color: brand.ink, fontSize: "14px", fontWeight: 700, margin: "0 0 4px" };
const listItem: React.CSSProperties = { color: brand.ink, fontSize: "14px", lineHeight: "21px", margin: "0 0 2px" };
const addressLine: React.CSSProperties = { color: brand.ink, fontSize: "15px", lineHeight: "22px", margin: 0 };
const button: React.CSSProperties = {
  backgroundColor: brand.purple,
  color: "#ffffff",
  borderRadius: "8px",
  padding: "12px 20px",
  fontWeight: 600,
  fontSize: "15px",
  textDecoration: "none",
  display: "inline-block",
};
const link: React.CSSProperties = { color: brand.purple, textDecoration: "underline", wordBreak: "break-all" };
