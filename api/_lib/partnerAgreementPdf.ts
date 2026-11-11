import { PDFDocument, StandardFonts } from "pdf-lib";
import { parseAgreement, partnerAckLabel } from "../../src/store/lib/partnerAgreement.js";
import type { PartnerKind } from "../../src/store/lib/partnerTypes.js";
import { BRAND, LINE, MARGIN, MUTED, PAGE_W, Writer, centralTime, pdfSafe } from "./consignmentPdf.js";

// The signed partner agreement as a PDF: the exact text that was signed
// (rendered from the same blocks the signing page shows), then a signing
// record page with the partner's signer and the legal entity they signed for,
// Geega Games' countersignature (when the agreement needs one), every box
// ticked, and the SHA-256 fingerprints of the agreement text and of each
// signing record. Every page's footer repeats the agreement fingerprint. Uses
// the consignment PDF's writer (Helvetica, US Letter).

export interface PartnerAgreementPdfInput {
  kind: PartnerKind;
  title: string;
  versionNumber: number;
  businessName: string;
  renderedMd: string;
  agreementSha256: string;
  recordSha256: string;
  legalName: string;
  signerTitle: string;
  typedSignature: string;
  email: string;
  signedAt: string;
  ip: string | null;
  userAgent: string | null;
  /** The boxes the agreement asked for, in order. */
  requiredAcks: string[];
  acknowledgments: Record<string, boolean>;
  /** The legal entity the partner signed for (version 2 Referral Partner Agreement). */
  entity?: { description: string; address: string } | null;
  /** Geega Games' countersignature, when the agreement needed one. */
  countersign?: {
    name: string;
    title: string;
    typedSignature: string;
    email: string | null;
    at: string;
    ip: string | null;
    userAgent: string | null;
    recordSha256: string;
  } | null;
}

export async function buildPartnerAgreementPdf(d: PartnerAgreementPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const signedAt = new Date(d.signedAt);
  const executedAt = d.countersign ? new Date(d.countersign.at) : signedAt;
  pdf.setTitle(`${d.title} - ${d.businessName}`);
  pdf.setAuthor("Geega Games");
  pdf.setSubject(`Signed by ${d.legalName} for ${d.businessName}`);
  pdf.setCreator("Geega Games partner agreement signing");
  pdf.setProducer("Geega Games");
  pdf.setKeywords([
    `agreement-sha256:${d.agreementSha256}`,
    `record-sha256:${d.recordSha256}`,
    ...(d.countersign ? [`countersign-sha256:${d.countersign.recordSha256}`] : []),
  ]);
  pdf.setCreationDate(executedAt);
  pdf.setModificationDate(executedAt);

  const w = new Writer(pdf, fonts);
  const signedLine = `Signed electronically by ${d.legalName} (${d.signerTitle}) for ${d.entity?.description ?? d.businessName} on ${centralTime(d.signedAt)}.`;
  const countersignedLine = d.countersign
    ? ` Countersigned for Geega Games LLC by ${d.countersign.name} (${d.countersign.title}) on ${centralTime(d.countersign.at)}, the Effective Date.`
    : "";
  w.text([{ text: signedLine + countersignedLine, bold: false }], { size: 9.5, color: MUTED, gapAfter: 10 });
  for (const b of parseAgreement(d.renderedMd)) w.block(b);

  w.newPage();
  w.text([{ text: "Electronic signing record", bold: true }], { size: 15, color: BRAND, gapAfter: 10 });
  w.field("Agreement", `${d.title}, version ${d.versionNumber}`);
  if (d.countersign) w.field("Effective Date", centralTime(d.countersign.at));
  w.y -= 4;
  w.text([{ text: d.kind === "store" ? "Partner store's signature" : "Referral Partner's signature", bold: true }], { size: 11, gapAfter: 2 });
  w.field("Business", d.businessName);
  if (d.entity) {
    w.field("Legal entity", d.entity.description);
    w.field("Business address", d.entity.address);
  }
  w.field("Signed by (legal name)", d.legalName);
  w.field("Title or role", d.signerTitle);
  w.field("Typed signature", d.typedSignature);
  w.field("Email (link sent to)", d.email);
  w.field("Signed at", `${centralTime(d.signedAt)} (${signedAt.toISOString()})`);
  w.field("IP address", d.ip ?? "Not recorded");
  w.field("Browser", d.userAgent ?? "Not recorded");
  if (d.countersign) {
    const c = d.countersign;
    w.y -= 6;
    w.text([{ text: "Geega Games' countersignature", bold: true }], { size: 11, gapAfter: 2 });
    w.field("For", "Geega Games LLC, a Missouri limited liability company");
    w.field("Signed by (legal name)", c.name);
    w.field("Title", c.title);
    w.field("Typed signature", c.typedSignature);
    if (c.email) w.field("Account", c.email);
    w.field("Countersigned at", `${centralTime(c.at)} (${new Date(c.at).toISOString()})`);
    w.field("IP address", c.ip ?? "Not recorded");
    w.field("Browser", c.userAgent ?? "Not recorded");
  }
  w.y -= 6;
  w.text([{ text: "Boxes ticked by the partner's signer", bold: true }], { size: 11, gapAfter: 2 });
  for (const key of d.requiredAcks) {
    w.text([{ text: `${d.acknowledgments[key] ? "Yes" : "No"} - ${partnerAckLabel(d.kind, key)}`, bold: false }], {
      size: 9.5,
      indent: 8,
      gapAfter: 2,
    });
  }
  w.y -= 8;
  w.text([{ text: "Fingerprints", bold: true }], { size: 11, gapAfter: 2 });
  w.field("Agreement text SHA-256", d.agreementSha256);
  w.field(d.countersign ? "Partner record SHA-256" : "Signing record SHA-256", d.recordSha256);
  if (d.countersign) w.field("Countersign SHA-256", d.countersign.recordSha256);
  w.y -= 6;
  w.text(
    [
      {
        text:
          "This PDF was generated by Geega Games' signing system from the electronic records kept when the agreement was signed. The SHA-256 fingerprints identify the exact agreement text and signing records held by Geega Games; any change to any of them would change its fingerprint. The PDF file's own fingerprint is stored with the record and sent with the signed copy. This document is not certified or notarized by any third party.",
        bold: false,
      },
    ],
    { size: 8.5, color: MUTED },
  );

  const total = w.pages.length;
  const footer = pdfSafe(
    `${d.businessName.length > 40 ? `${d.businessName.slice(0, 39)}…` : d.businessName} · ${d.title} v${d.versionNumber} · Agreement SHA-256 ${d.agreementSha256.slice(0, 16)}...`,
    fonts.regular,
  );
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
