import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  ACKNOWLEDGMENTS,
  consignmentLabel,
  parseAgreement,
  plainText,
  type AgreementBlock,
  type Inline,
} from "../../src/store/lib/consignmentAgreement.js";
import { CHANNEL_LABELS, CONSIGNMENT_CHANNELS, type ConsignmentChannel } from "../../src/store/lib/consignmentMath.js";

// The signed consignment agreement as a PDF: the exact agreement text that
// was signed (rendered from the same blocks the signing page shows), then a
// signing record page with the signer, every election and acknowledgment, and
// the SHA-256 fingerprints of the agreement text and the signing record. Each
// page's footer repeats the agreement fingerprint. The PDF's own SHA-256 is
// stored with the signature, so a copy can be checked against the record.
//
// Uses pdf-lib's standard Helvetica (no font files to bundle). It can only
// draw Windows-1252 characters, so anything else is replaced first.

export interface SignedAgreementPdfInput {
  consignmentNumber: number;
  versionNumber: number;
  title: string;
  renderedMd: string;
  agreementSha256: string;
  recordSha256: string;
  legalName: string;
  typedSignature: string;
  email: string;
  userId: string;
  signedAt: string;
  ip: string | null;
  userAgent: string | null;
  channels: Record<ConsignmentChannel, boolean>;
  additionalInsurance: boolean;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 30;
const INK = rgb(0.1, 0.08, 0.15);
const MUTED = rgb(0.42, 0.38, 0.46);
const LINE = rgb(0.85, 0.82, 0.9);
const BRAND = rgb(0.3, 0.16, 0.52);

const REPLACEMENTS: Record<string, string> = {
  "−": "-",
  "≤": "<=",
  "≥": ">=",
  "→": "->",
  "←": "<-",
  "…": "...",
  " ": " ",
  " ": " ",
  " ": " ",
  "‑": "-",
  "✓": "Yes",
};

/** Text Helvetica can draw: known look-alikes swapped, anything else as "?". */
export function pdfSafe(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text.replace(/[−≤≥→←…   ‑✓]/g, (c) => REPLACEMENTS[c] ?? c)) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

type Fonts = { regular: PDFFont; bold: PDFFont };
/** A word, possibly in several runs ("**Title**," is bold "Title" + plain ","). */
type Word = { segs: { text: string; bold: boolean }[] };

class Writer {
  pdf: PDFDocument;
  fonts: Fonts;
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];

  constructor(pdf: PDFDocument, fonts: Fonts) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_H) this.newPage();
  }

  font(bold: boolean) {
    return bold ? this.fonts.bold : this.fonts.regular;
  }

  wordWidth(w: Word, size: number): number {
    return w.segs.reduce((n, s) => n + this.font(s.bold).widthOfTextAtSize(s.text, size), 0);
  }

  /** Runs of bold/plain text wrapped to `width`, as lines of words. */
  wrap(runs: Inline[], size: number, width: number): Word[][] {
    const words: Word[] = [];
    let glue = false; // the next piece continues the previous word (no space between runs)
    for (const r of runs) {
      const safe = pdfSafe(r.text, this.font(r.bold));
      const pieces = safe.split(/(\s+)/);
      for (const piece of pieces) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) {
          glue = false;
          continue;
        }
        if (glue && words.length) words[words.length - 1].segs.push({ text: piece, bold: r.bold });
        else words.push({ segs: [{ text: piece, bold: r.bold }] });
        glue = true;
      }
    }
    const lines: Word[][] = [];
    let line: Word[] = [];
    let lineW = 0;
    const space = this.fonts.regular.widthOfTextAtSize(" ", size);
    for (const w of words) {
      const ww = this.wordWidth(w, size);
      // A single word wider than the line (a long hash or URL) is split.
      if (ww > width) {
        if (line.length) {
          lines.push(line);
          line = [];
          lineW = 0;
        }
        for (const seg of w.segs) {
          let rest = seg.text;
          while (rest) {
            let n = rest.length;
            while (n > 1 && this.font(seg.bold).widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
            lines.push([{ segs: [{ text: rest.slice(0, n), bold: seg.bold }] }]);
            rest = rest.slice(n);
          }
        }
        continue;
      }
      const add = line.length ? space + ww : ww;
      if (lineW + add > width && line.length) {
        lines.push(line);
        line = [w];
        lineW = ww;
      } else {
        line.push(w);
        lineW += add;
      }
    }
    if (line.length) lines.push(line);
    return lines;
  }

  drawLine(words: Word[], x: number, y: number, size: number, color = INK) {
    const space = this.fonts.regular.widthOfTextAtSize(" ", size);
    let cx = x;
    for (const w of words) {
      for (const seg of w.segs) {
        const f = this.font(seg.bold);
        this.page.drawText(seg.text, { x: cx, y, size, font: f, color });
        cx += f.widthOfTextAtSize(seg.text, size);
      }
      cx += space;
    }
  }

  text(runs: Inline[], opts: { size?: number; indent?: number; gapAfter?: number; color?: ReturnType<typeof rgb>; leading?: number } = {}) {
    const size = opts.size ?? 10;
    const leading = opts.leading ?? size * 1.4;
    const indent = opts.indent ?? 0;
    for (const line of this.wrap(runs, size, CONTENT_W - indent)) {
      this.ensure(leading);
      this.y -= leading;
      this.drawLine(line, MARGIN + indent, this.y + (leading - size) / 2, size, opts.color);
    }
    this.y -= opts.gapAfter ?? 6;
  }

  block(b: AgreementBlock) {
    switch (b.type) {
      case "heading":
        this.ensure(40);
        this.y -= 6;
        this.text(b.text.map((r) => ({ ...r, bold: true })), { size: b.level <= 2 ? 13 : 11, gapAfter: 4, color: BRAND });
        return;
      case "paragraph":
        this.text(b.text);
        return;
      case "list":
        b.items.forEach((item, i) => {
          const marker = b.ordered ? `${i + 1}.` : "-";
          const size = 10;
          const lines = this.wrap(item, size, CONTENT_W - 20);
          lines.forEach((line, j) => {
            this.ensure(size * 1.4);
            this.y -= size * 1.4;
            if (j === 0) this.page.drawText(marker, { x: MARGIN + 4, y: this.y + 2, size, font: this.fonts.regular, color: INK });
            this.drawLine(line, MARGIN + 20, this.y + 2, size);
          });
          this.y -= 2;
        });
        this.y -= 4;
        return;
      case "table":
        this.table(b.header, b.rows);
        return;
    }
  }

  table(header: Inline[][], rows: Inline[][][]) {
    const cols = header.length;
    // The first column is short labels; the rest share the remaining width.
    const widths = cols === 3 ? [0.22, 0.5, 0.28] : cols === 2 ? [0.5, 0.5] : Array(cols).fill(1 / cols);
    const pad = 4;
    const size = 9;
    const leading = size * 1.35;
    const drawRow = (cells: Inline[][], bold: boolean) => {
      const wrapped = cells.map((c, i) => this.wrap(bold ? c.map((r) => ({ ...r, bold: true })) : c, size, widths[i] * CONTENT_W - pad * 2));
      const h = Math.max(...wrapped.map((l) => l.length)) * leading + pad * 2;
      this.ensure(h);
      let x = MARGIN;
      const top = this.y;
      wrapped.forEach((lines, i) => {
        const w = widths[i] * CONTENT_W;
        this.page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: LINE, borderWidth: 0.75 });
        lines.forEach((line, j) => this.drawLine(line, x + pad, top - pad - (j + 1) * leading + (leading - size) / 2 + 1, size));
        x += w;
      });
      this.y -= h;
    };
    drawRow(header, true);
    for (const r of rows) drawRow(r, false);
    this.y -= 8;
  }

  field(label: string, value: string) {
    const size = 9.5;
    const labelW = 150;
    const lines = this.wrap([{ text: value, bold: false }], size, CONTENT_W - labelW);
    const leading = size * 1.4;
    this.ensure(lines.length * leading + 4);
    lines.forEach((line, i) => {
      this.y -= leading;
      if (i === 0) this.page.drawText(pdfSafe(label, this.fonts.bold), { x: MARGIN, y: this.y + 2, size, font: this.fonts.bold, color: MUTED });
      this.drawLine(line, MARGIN + labelW, this.y + 2, size);
    });
    this.y -= 4;
  }
}

function centralTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "long",
    timeStyle: "long",
  });
}

export async function buildSignedAgreementPdf(d: SignedAgreementPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const label = consignmentLabel(d.consignmentNumber);
  const signedAt = new Date(d.signedAt);
  pdf.setTitle(`${d.title} - ${label}`);
  pdf.setAuthor("Geega Games");
  pdf.setSubject(`Signed by ${d.legalName}`);
  pdf.setCreator("Geega Games consignment signing");
  pdf.setProducer("Geega Games");
  pdf.setKeywords([`agreement-sha256:${d.agreementSha256}`, `record-sha256:${d.recordSha256}`]);
  pdf.setCreationDate(signedAt);
  pdf.setModificationDate(signedAt);

  const w = new Writer(pdf, fonts);
  w.text([{ text: d.title, bold: true }], { size: 18, color: BRAND, gapAfter: 2 });
  w.text([{ text: `${label} · Version ${d.versionNumber} · Signed electronically by ${d.legalName} on ${centralTime(d.signedAt)}`, bold: false }], {
    size: 9.5,
    color: MUTED,
    gapAfter: 14,
  });
  for (const b of parseAgreement(d.renderedMd)) w.block(b);

  w.newPage();
  w.text([{ text: "Electronic signing record", bold: true }], { size: 15, color: BRAND, gapAfter: 10 });
  w.field("Consignment", label);
  w.field("Agreement version", String(d.versionNumber));
  w.field("Signed by (legal name)", d.legalName);
  w.field("Typed signature", d.typedSignature);
  w.field("Email", d.email);
  w.field("Geega Games account", d.userId);
  w.field("Signed at", `${centralTime(d.signedAt)} (${signedAt.toISOString()})`);
  w.field("IP address", d.ip ?? "Not recorded");
  w.field("Browser", d.userAgent ?? "Not recorded");
  w.y -= 6;
  w.text([{ text: "Sales channels", bold: true }], { size: 11, gapAfter: 2 });
  for (const c of CONSIGNMENT_CHANNELS) w.field(CHANNEL_LABELS[c], d.channels[c] ? "Yes, approved" : "No, declined");
  w.y -= 6;
  w.text([{ text: "Shipping insurance", bold: true }], { size: 11, gapAfter: 2 });
  w.field(
    "Additional insurance",
    d.additionalInsurance ? "Approved (Option A): premiums are a shipping expense" : "Declined (Option B): only included coverage applies",
  );
  w.y -= 6;
  w.text([{ text: "Acknowledgments (each ticked by the signer)", bold: true }], { size: 11, gapAfter: 2 });
  for (const a of ACKNOWLEDGMENTS) w.text([{ text: `Yes - ${a.label}`, bold: false }], { size: 9.5, indent: 8, gapAfter: 2 });
  w.y -= 8;
  w.text([{ text: "Fingerprints", bold: true }], { size: 11, gapAfter: 2 });
  w.field("Agreement text SHA-256", d.agreementSha256);
  w.field("Signing record SHA-256", d.recordSha256);
  w.y -= 6;
  w.text(
    [
      {
        text:
          "This PDF was generated by Geega Games' signing system from the electronic record kept when the agreement was signed. The SHA-256 fingerprints identify the exact agreement text and signing record held by Geega Games; any change to either would change its fingerprint. The PDF file's own fingerprint is stored with the record and shown in your account. This document is not certified or notarized by any third party.",
        bold: false,
      },
    ],
    { size: 8.5, color: MUTED },
  );

  const total = w.pages.length;
  const footer = pdfSafe(`${label} · Agreement version ${d.versionNumber} · Agreement SHA-256 ${d.agreementSha256.slice(0, 16)}...`, fonts.regular);
  w.pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 14 }, thickness: 0.5, color: LINE });
    p.drawText(footer, { x: MARGIN, y: MARGIN, size: 7.5, font: fonts.regular, color: MUTED });
    const pageText = `Page ${i + 1} of ${total}`;
    p.drawText(pageText, {
      x: PAGE_W - MARGIN - fonts.regular.widthOfTextAtSize(pageText, 7.5),
      y: MARGIN,
      size: 7.5,
      font: fonts.regular,
      color: MUTED,
    });
  });

  return pdf.save({ useObjectStreams: false });
}

/** Re-export for callers that only need the plain text of a block run. */
export { plainText };
