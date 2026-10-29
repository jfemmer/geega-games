import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { HttpError } from "./http.js";
import { pdfSafe } from "./consignmentPdf.js";
import { consignmentLabel } from "../../src/store/lib/consignmentAgreement.js";
import { CHANNEL_LABELS, formatBps, type ConsignmentChannel } from "../../src/store/lib/consignmentMath.js";

// A payout statement (agreement 6.3): every card the payment covers with its
// Final Selling Price, each Transaction Expense, the Commission and the
// proceeds, plus any adjustments, and the total paid. Built on request from
// the ledger, never stored, so it always matches the records.

type Admin = ReturnType<typeof getSupabaseAdmin>;

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const INK = rgb(0.1, 0.08, 0.15);
const MUTED = rgb(0.42, 0.38, 0.46);
const LINE = rgb(0.85, 0.82, 0.9);
const BRAND = rgb(0.3, 0.16, 0.52);

const usd = (c: number | null | undefined) => {
  const v = c ?? 0;
  return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 100).toFixed(2)}`;
};
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "-";

const METHODS: Record<string, string> = {
  paypal: "PayPal",
  venmo: "Venmo",
  zelle: "Zelle",
  check: "Check",
  ach: "Bank transfer (ACH)",
  store_credit: "Store credit",
};

export interface StatementData {
  consignmentNumber: number;
  consignorName: string;
  consignorEmail: string;
  payout: { id: string; amount_cents: number; method: string; reference: string | null; paid_at: string; voided_at: string | null; void_reason: string | null };
  sales: {
    card_name: string;
    channel: ConsignmentChannel;
    sold_at: string;
    delivered_at: string | null;
    quantity: number;
    unit_price_cents: number;
    gross_cents: number;
    marketplace_fee_cents: number | null;
    processing_fee_cents: number | null;
    postage_cents: number | null;
    insurance_cents: number | null;
    other_expense_cents: number | null;
    other_expense_note: string | null;
    net_sale_cents: number | null;
    commission_rate_bps: number | null;
    commission_cents: number | null;
    payout_cents: number | null;
  }[];
  adjustments: { kind: string; amount_cents: number; reason: string; created_at: string }[];
}

/** Load a payout's statement. With `userId`, only the consignor's own (404 otherwise). */
export async function loadStatement(admin: Admin, payoutId: string, userId?: string): Promise<StatementData> {
  if (!/^[0-9a-f-]{36}$/i.test(payoutId)) throw new HttpError(400, "Choose a payout.");
  const { data: payout } = await admin.from("consignment_payouts").select("*").eq("id", payoutId).maybeSingle();
  if (!payout) throw new HttpError(404, "That statement isn't there.");
  const { data: c } = await admin.from("consignments").select("id, consignment_number, consignor_id").eq("id", payout.consignment_id).single();
  const { data: p } = await admin.from("consignors").select("legal_name, email, user_id").eq("id", c!.consignor_id).single();
  // Someone else's statement looks the same as none.
  if (userId !== undefined && p?.user_id !== userId) throw new HttpError(404, "That statement isn't there.");
  const [{ data: sales }, { data: adjustments }] = await Promise.all([
    admin.from("consignment_sales").select("*").eq("payout_id", payoutId).order("sold_at", { ascending: true }),
    admin.from("consignment_adjustments").select("kind, amount_cents, reason, created_at").eq("payout_id", payoutId).order("created_at", { ascending: true }),
  ]);
  const lotIds = [...new Set((sales ?? []).map((s) => s.lot_id))];
  const { data: lots } = lotIds.length ? await admin.from("consignment_lots").select("id, card_name, set_code, collector_number").in("id", lotIds) : { data: [] };
  const name = new Map((lots ?? []).map((l) => [l.id, `${l.card_name} (${l.set_code.toUpperCase()} #${l.collector_number})`]));
  return {
    consignmentNumber: c!.consignment_number,
    consignorName: p!.legal_name,
    consignorEmail: p!.email,
    payout,
    sales: (sales ?? []).map((s) => ({ ...s, card_name: name.get(s.lot_id) ?? "Card", channel: s.channel as ConsignmentChannel })),
    adjustments: adjustments ?? [],
  };
}

export async function buildStatementPdf(d: StatementData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Payout statement ${consignmentLabel(d.consignmentNumber)}`);
  doc.setAuthor("Geega Games");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const text = (t: string, x: number, size = 9, f: PDFFont = font, color = INK) => page.drawText(pdfSafe(t, f), { x, y, size, font: f, color });
  const right = (t: string, xRight: number, size = 9, f: PDFFont = font, color = INK) => {
    const s = pdfSafe(t, f);
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  };
  const ensure = (h: number) => {
    if (y - h < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };
  const rule = () => {
    page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_W - MARGIN, y: y + 4 }, thickness: 0.6, color: LINE });
  };

  text("Geega Games", MARGIN, 16, bold, BRAND);
  y -= 22;
  text(`Consignment payout statement - ${consignmentLabel(d.consignmentNumber)}`, MARGIN, 12, bold);
  y -= 18;
  text(`${d.consignorName} (${d.consignorEmail})`, MARGIN, 10);
  y -= 14;
  text(
    `Paid ${day(d.payout.paid_at)} by ${METHODS[d.payout.method] ?? d.payout.method}${d.payout.reference ? `, reference ${d.payout.reference}` : ""}`,
    MARGIN,
    10,
  );
  y -= 14;
  if (d.payout.voided_at) {
    text(`VOID: ${d.payout.void_reason ?? ""}`, MARGIN, 10, bold, rgb(0.6, 0.1, 0.1));
    y -= 14;
  }
  y -= 8;

  const cols = [MARGIN, 300, 360, 420, 480, PAGE_W - MARGIN];
  for (const s of d.sales) {
    ensure(120);
    rule();
    y -= 10;
    text(s.card_name, MARGIN, 10, bold);
    right(usd(s.payout_cents), PAGE_W - MARGIN, 10, bold);
    y -= 13;
    text(
      `${CHANNEL_LABELS[s.channel]} · sold ${day(s.sold_at)}${s.delivered_at ? ` · delivered ${day(s.delivered_at)}` : ""} · ${s.quantity} x ${usd(s.unit_price_cents)}`,
      MARGIN,
      8.5,
      font,
      MUTED,
    );
    y -= 14;
    const rows: [string, number | null][] = [
      ["Final Selling Price", s.gross_cents],
      ["Marketplace fee", -(s.marketplace_fee_cents ?? 0)],
      ["Payment processing", -(s.processing_fee_cents ?? 0)],
      ["Postage (after buyer-paid shipping)", -(s.postage_cents ?? 0)],
      ["Additional insurance", -(s.insurance_cents ?? 0)],
    ];
    if ((s.other_expense_cents ?? 0) > 0) rows.push([`Other: ${s.other_expense_note ?? "approved expense"}`, -(s.other_expense_cents ?? 0)]);
    rows.push(["Net Sale Amount", s.net_sale_cents]);
    rows.push([`Commission (${formatBps(s.commission_rate_bps ?? 0)})`, -(s.commission_cents ?? 0)]);
    for (const [label, cents] of rows) {
      text(label, cols[0] + 12, 9);
      right(usd(cents), cols[5], 9);
      y -= 12;
    }
    y -= 4;
  }

  if (d.adjustments.length) {
    ensure(40);
    rule();
    y -= 10;
    text("Adjustments", MARGIN, 10, bold);
    y -= 14;
    for (const a of d.adjustments) {
      ensure(24);
      const reason = pdfSafe(a.reason, font);
      text(`${day(a.created_at)} - ${reason.length > 90 ? `${reason.slice(0, 87)}...` : reason}`, MARGIN + 12, 9);
      right(usd(a.amount_cents), PAGE_W - MARGIN, 9);
      y -= 12;
    }
    y -= 4;
  }

  ensure(60);
  rule();
  y -= 14;
  text("Total paid", MARGIN, 11, bold);
  right(usd(d.payout.amount_cents), PAGE_W - MARGIN, 11, bold);
  y -= 22;
  const note =
    "Expenses are the actual Transaction Expenses of each sale (agreement section 4). Commission is applied to the Net Sale Amount at the rate for the card's Final Selling Price. Questions about this statement: tell us within 60 days (section 6.7).";
  const words = pdfSafe(note, font).split(" ");
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, 8) > PAGE_W - MARGIN * 2) {
      text(line, MARGIN, 8, font, MUTED);
      y -= 11;
      line = w;
    } else line = next;
  }
  if (line) text(line, MARGIN, 8, font, MUTED);
  return doc.save();
}
