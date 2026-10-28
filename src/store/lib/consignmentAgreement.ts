// The consignment agreement's text: filling a version's template with the
// terms in force when it's sent, checking a draft is ready to publish, and
// reading the text into blocks that both the signing page and the signed PDF
// render from (so the PDF shows exactly what was signed).
//
// Pure module: no React, browser, Node or Supabase imports.

import { formatCents } from "./money.js";
import {
  CHANNEL_LABELS,
  CONSIGNMENT_CHANNELS,
  formatBps,
  type ChannelFeeSchedule,
  type CommissionTier,
  type ConsignmentChannel,
  type FeeBase,
} from "./consignmentMath.js";

export const ACKNOWLEDGMENTS = [
  { key: "esign", label: "I consent to use electronic records and signatures, as described in Section 9.4." },
  { key: "reviewed", label: "I have reviewed this entire agreement." },
  {
    key: "commission",
    label: "I understand Geega Games' commission is a percentage of each card's Net Sale Amount, at the rates in Section 4.1.",
  },
  {
    key: "deductions",
    label: "I understand marketplace fees, payment processing, postage and any insurance I approve are deducted before the commission (Section 4.3).",
  },
  {
    key: "shipping_liability",
    label: "I understand how carrier loss and damage are handled, including the risk I accept if I decline additional insurance (Section 5).",
  },
  {
    key: "inspection",
    label: "I understand I'm paid after the buyer inspection period, which starts the day after delivery (Section 6).",
  },
  { key: "term", label: "I understand the initial term and that it then continues month to month (Section 7)." },
  { key: "estimates", label: "I understand payout estimates are estimates only; my actual proceeds use each sale's actual expenses." },
] as const;

export type AcknowledgmentKey = (typeof ACKNOWLEDGMENTS)[number]["key"];

export const CHANNEL_DISCLOSURES: Record<ConsignmentChannel, string> = {
  website:
    "Sales on geega-games.com. Card payment processing applies; there is no third-party marketplace commission.",
  tcgplayer: "Sales on TCGplayer under Geega Games' seller account. TCGplayer's commission and processing apply.",
  ebay: "Sales on eBay under Geega Games' account. eBay's fee is charged on the total the buyer pays, including shipping and sales tax, and includes processing.",
};

/** "GG-C-1001" */
export function consignmentLabel(n: number | string): string {
  return `GG-C-${n}`;
}

// ---------------------------------------------------------------- terms snapshot

export interface InsuranceTerms {
  service: string;
  includedCoverageCents: number;
  effectiveFrom: string | null;
}

export interface AgreementTerms {
  capturedAt: string;
  channels: Partial<Record<ConsignmentChannel, ChannelFeeSchedule & { effectiveFrom?: string | null; sourceNote?: string | null }>>;
  commissionTiers: CommissionTier[];
  insurance: InsuranceTerms;
  minCardValueCents: number;
  initialTermDays: number;
  inspectionDays: number;
  payoutMethods: string[];
  supportEmail: string;
}

const PAYOUT_LABELS: Record<string, string> = {
  paypal: "PayPal",
  venmo: "Venmo",
  zelle: "Zelle",
  check: "check",
  ach: "bank transfer (ACH)",
  store_credit: "Geega Games store credit",
};

const BASE_LABELS: Record<FeeBase, string> = {
  item: "The card's price",
  item_shipping: "The card's price plus the shipping the buyer pays",
  item_shipping_tax: "The total the buyer pays, including shipping and sales tax",
};

/** "PayPal, Venmo, Zelle, or check" */
export function listWithOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

/** One channel's fees in a sentence, for the agreement and the account page. */
export function describeChannelFees(s: ChannelFeeSchedule): string {
  const parts: string[] = [];
  if (s.marketplaceBps > 0) {
    parts.push(
      s.marketplaceThresholdCents != null && s.marketplaceAboveThresholdBps != null
        ? `Marketplace fee ${formatBps(s.marketplaceBps)} up to ${formatCents(s.marketplaceThresholdCents)} per item and ${formatBps(s.marketplaceAboveThresholdBps)} above it`
        : `Marketplace fee ${formatBps(s.marketplaceBps)}`,
    );
  } else {
    parts.push("No marketplace commission");
  }
  if (s.perOrderCents > 0) {
    parts.push(
      s.perOrderSmallCents != null && s.perOrderSmallMaxCents != null
        ? `${formatCents(s.perOrderCents)} per order (${formatCents(s.perOrderSmallCents)} for orders of ${formatCents(s.perOrderSmallMaxCents)} or less)`
        : `${formatCents(s.perOrderCents)} per order`,
    );
  }
  if (s.processingBps > 0 || s.processingFixedCents > 0) {
    parts.push(`payment processing ${formatBps(s.processingBps)} + ${formatCents(s.processingFixedCents)} per order`);
  } else if (s.channel !== "website") {
    parts.push("payment processing included");
  }
  return parts.join("; ") + ".";
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
}

export function feeTableMd(terms: AgreementTerms): string {
  const rows = CONSIGNMENT_CHANNELS.filter((c) => terms.channels[c]).map((c) => {
    const s = terms.channels[c]!;
    return `| ${CHANNEL_LABELS[c]} | ${describeChannelFees(s)} | ${BASE_LABELS[s.marketplaceBps > 0 ? s.marketplaceBase : s.processingBase]} |`;
  });
  return [`| Sales Channel | What the channel charges (as of ${dateLabel(terms.capturedAt)}) | Fees charged on |`, "| --- | --- | --- |", ...rows].join("\n");
}

export function commissionTableMd(tiers: CommissionTier[]): string {
  const sorted = [...tiers].sort((a, b) => (a.maxPriceCents ?? Infinity) - (b.maxPriceCents ?? Infinity));
  const rows = sorted.map((t, i) => {
    const prev = i > 0 ? sorted[i - 1].maxPriceCents : null;
    const range =
      t.maxPriceCents == null
        ? prev == null
          ? "Any price"
          : `${formatCents(prev + 1)} or more`
        : prev == null
          ? `${formatCents(t.maxPriceCents)} or less`
          : `${formatCents(prev + 1)} to ${formatCents(t.maxPriceCents)}`;
    return `| ${range} | ${formatBps(t.rateBps)} of the Net Sale Amount |`;
  });
  return ["| Final Selling Price of the individual card | Commission rate |", "| --- | --- |", ...rows].join("\n");
}

// ---------------------------------------------------------------- template

export interface RenderContext {
  versionNumber: number;
  consignmentNumber: number;
  consignorName: string;
  terms: AgreementTerms;
}

export const TEMPLATE_TOKENS = [
  "agreement_version",
  "consignment_number",
  "consignor_name",
  "fee_table",
  "commission_table",
  "min_card_value",
  "initial_term_days",
  "inspection_days",
  "payout_methods",
  "support_email",
  "insurance_service",
  "included_coverage",
] as const;

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Strip anything that would let a value change the document's structure. */
function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[*|{}[\]<>`]/g, "").trim();
}

export function renderAgreement(template: string, ctx: RenderContext): string {
  const t = ctx.terms;
  const values: Record<(typeof TEMPLATE_TOKENS)[number], string> = {
    agreement_version: String(ctx.versionNumber),
    consignment_number: consignmentLabel(ctx.consignmentNumber),
    consignor_name: inline(ctx.consignorName),
    fee_table: feeTableMd(t),
    commission_table: commissionTableMd(t.commissionTiers),
    min_card_value: t.minCardValueCents > 0 ? formatCents(t.minCardValueCents) : "$0.00 (no minimum is currently set)",
    initial_term_days: String(t.initialTermDays),
    inspection_days: String(t.inspectionDays),
    payout_methods: listWithOr(t.payoutMethods.map((m) => PAYOUT_LABELS[m] ?? m)),
    support_email: inline(t.supportEmail),
    insurance_service: inline(t.insurance.service),
    included_coverage: formatCents(t.insurance.includedCoverageCents),
  };
  return template.replace(TOKEN_RE, (whole, name: string) => {
    if (!(name in values)) throw new Error(`The agreement uses an unknown field: ${whole}`);
    return values[name as keyof typeof values];
  });
}

export interface PublishProblem {
  kind: "blank" | "unknown_field";
  text: string;
}

/**
 * What stops a draft from being published: bracketed blanks or notes left to
 * resolve ("[business mailing address]", "[Attorney: ...]"), and {{fields}}
 * the renderer doesn't know. Markdown links ([text](url)) are fine.
 */
export function publishProblems(body: string): PublishProblem[] {
  const out: PublishProblem[] = [];
  for (const m of body.matchAll(/\[([^\]\n]{1,300})\](?!\()/g)) out.push({ kind: "blank", text: m[0] });
  for (const m of body.matchAll(TOKEN_RE)) {
    if (!(TEMPLATE_TOKENS as readonly string[]).includes(m[1])) out.push({ kind: "unknown_field", text: m[0] });
  }
  return out;
}

// ---------------------------------------------------------------- blocks

export type Inline = { text: string; bold: boolean };
export type AgreementBlock =
  | { type: "heading"; level: number; text: Inline[] }
  | { type: "paragraph"; text: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] };

/** "**2.1 Title.** body" → bold and plain runs. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) out.push({ text: part.slice(2, -2), bold: true });
    else out.push({ text: part, bold: false });
  }
  return out;
}

export const plainText = (runs: Inline[]) => runs.map((r) => r.text).join("");

const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

/** The agreement's markdown (the subset the agreement uses) as blocks. */
export function parseAgreement(md: string): AgreementBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: AgreementBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: parseInline(heading[2].trim()) });
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const body = rows.filter((r, idx) => !(idx === 1 && /^\|?\s*:?-{3,}/.test(r.trim())));
      blocks.push({ type: "table", header: tableCells(body[0]), rows: body.slice(1).map(tableCells) });
      continue;
    }
    const ordered = /^\s*\d+\.\s+/.test(line);
    const bullet = /^\s*[-*]\s+/.test(line);
    if (ordered || bullet) {
      const items: Inline[][] = [];
      const re = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && re.test(lines[i])) items.push(parseInline(lines[i++].replace(re, "").trim()));
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*\d+\.\s|\s*[-*]\s)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push({ type: "paragraph", text: parseInline(para.join(" ")) });
  }
  return blocks;
}

// ---------------------------------------------------------------- elections

export type ChannelAnswers = Record<ConsignmentChannel, boolean | null>;

export function emptyAnswers(): ChannelAnswers {
  return { website: null, tcgplayer: null, ebay: null };
}

/** Why the form can't be signed yet, in the order the page asks. Empty = ready. */
export function signingProblems(input: {
  acknowledgments: Partial<Record<AcknowledgmentKey, boolean>>;
  channels: ChannelAnswers;
  additionalInsurance: boolean | null;
  legalName: string;
  typedSignature: string;
}): string[] {
  const out: string[] = [];
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  if (CONSIGNMENT_CHANNELS.some((c) => input.channels[c] === null)) out.push("Answer Yes or No for each sales channel.");
  else if (!CONSIGNMENT_CHANNELS.some((c) => input.channels[c] === true)) out.push("Approve at least one sales channel, or we can't sell your cards.");
  if (input.additionalInsurance === null) out.push("Choose whether to approve additional shipping insurance.");
  if (ACKNOWLEDGMENTS.some((a) => input.acknowledgments[a.key] !== true)) out.push("Tick every acknowledgment.");
  if (norm(input.legalName).length < 2) out.push("Enter your full legal name.");
  else if (norm(input.typedSignature) !== norm(input.legalName)) out.push("Type your full legal name again, exactly, as your signature.");
  return out;
}
