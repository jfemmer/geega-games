import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACKNOWLEDGMENTS,
  commissionTableMd,
  emptyAnswers,
  parseAgreement,
  plainText,
  publishProblems,
  renderAgreement,
  signingProblems,
  type AgreementTerms,
} from "../src/store/lib/consignmentAgreement";
import { buildSignedAgreementPdf, pdfSafe } from "../api/_lib/consignmentPdf";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ChannelFeeSchedule } from "../src/store/lib/consignmentMath";

// The consignment agreement's text: version 1 fills in completely from a
// terms snapshot, the blanks left for the owner and attorney block
// publishing, the text reads into blocks, the signing form's checks, and the
// signed PDF builds from the same blocks.

const V1 = readFileSync(new URL("../docs/consignment-agreement-v1.md", import.meta.url), "utf8");

const base: ChannelFeeSchedule = {
  channel: "website",
  marketplaceBps: 0,
  marketplaceThresholdCents: null,
  marketplaceAboveThresholdBps: null,
  marketplaceBase: "item",
  perOrderCents: 0,
  perOrderSmallCents: null,
  perOrderSmallMaxCents: null,
  processingBps: 290,
  processingFixedCents: 30,
  processingBase: "item_shipping_tax",
};

const terms: AgreementTerms = {
  capturedAt: "2026-10-28T17:00:00Z",
  channels: {
    website: base,
    tcgplayer: { ...base, channel: "tcgplayer", marketplaceBps: 1075, marketplaceBase: "item_shipping", processingBps: 250 },
    ebay: {
      ...base,
      channel: "ebay",
      marketplaceBps: 1325,
      marketplaceThresholdCents: 750000,
      marketplaceAboveThresholdBps: 235,
      marketplaceBase: "item_shipping_tax",
      perOrderCents: 40,
      perOrderSmallCents: 30,
      perOrderSmallMaxCents: 1000,
      processingBps: 0,
      processingFixedCents: 0,
    },
  },
  commissionTiers: [
    { maxPriceCents: 15000, rateBps: 2000 },
    { maxPriceCents: null, rateBps: 1000 },
  ],
  insurance: { service: "USPS Ground Advantage", includedCoverageCents: 10000, effectiveFrom: null },
  minCardValueCents: 500,
  initialTermDays: 90,
  inspectionDays: 3,
  payoutMethods: ["paypal", "venmo", "zelle", "check"],
  supportEmail: "support@geega-games.com",
};

const ctx = { versionNumber: 1, consignmentNumber: 1001, consignorName: "Pat Consignor", terms };

describe("rendering version 1", () => {
  it("fills every field", () => {
    const md = renderAgreement(V1, ctx);
    expect(md).not.toMatch(/\{\{/);
    expect(md).toContain("**Consignment ID:** GG-C-1001");
    expect(md).toContain("| Geega Games website | No marketplace commission; payment processing 2.9% + $0.30 per order.");
    expect(md).toContain("Marketplace fee 13.25% up to $7,500.00 per item and 2.35% above it; $0.40 per order ($0.30 for orders of $10.00 or less); payment processing included.");
    expect(md).toContain("| $150.00 or less | 20% of the Net Sale Amount |");
    expect(md).toContain("| $150.01 or more | 10% of the Net Sale Amount |");
    expect(md).toContain("minimum accepted value of $5.00 per card");
    expect(md).toContain("PayPal, Venmo, Zelle, or check");
    expect(md).toContain("buyer inspection period of 3 calendar days");
    expect(md).toContain("The initial consignment term is 90 calendar days");
  });

  it("keeps a consignor's name from changing the document's structure", () => {
    const md = renderAgreement(V1, { ...ctx, consignorName: "Pat\n## Section 99 | **evil**" });
    expect(md).toContain("**Consignor:** Pat ## Section 99  evil.");
    expect(parseAgreement(md).filter((b) => b.type === "heading").map((b) => plainText(b.text))).not.toContain("Section 99");
  });

  it("refuses an unknown field rather than leaving it blank", () => {
    expect(() => renderAgreement(V1 + "\n\n{{secret_field}}", ctx)).toThrow(/unknown field/);
  });

  it("shows a single open-ended tier as any price", () => {
    expect(commissionTableMd([{ maxPriceCents: null, rateBps: 1500 }])).toContain("| Any price | 15% of the Net Sale Amount |");
  });
});

describe("publishing", () => {
  it("blocks version 1 until the owner's blanks and the attorney notes are resolved", () => {
    const problems = publishProblems(V1).map((p) => p.text);
    expect(problems).toContain("[Geega Games legal entity name and form]");
    expect(problems).toContain("[business mailing address]");
    expect(problems.some((p) => p.startsWith("[Attorney:"))).toBe(true);
  });

  it("allows links and known fields, and flags unknown fields", () => {
    expect(publishProblems("See [our policy](https://geega-games.com/terms). {{fee_table}}")).toEqual([]);
    expect(publishProblems("{{nope}}")).toEqual([{ kind: "unknown_field", text: "{{nope}}" }]);
  });
});

describe("reading the text into blocks", () => {
  it("finds the sections, lists and tables", () => {
    const blocks = parseAgreement(renderAgreement(V1, ctx));
    const headings = blocks.filter((b) => b.type === "heading").map((b) => plainText(b.text));
    expect(headings).toHaveLength(9);
    expect(headings[0]).toBe("1. Parties and definitions");
    expect(blocks.filter((b) => b.type === "table")).toHaveLength(2);
    const fee = blocks.find((b) => b.type === "table");
    expect(fee?.type === "table" && fee.rows.length).toBe(3);
    const firstList = blocks.find((b) => b.type === "list");
    expect(firstList?.type === "list" && firstList.ordered && firstList.items.length).toBe(11);
  });

  it("keeps bold runs", () => {
    const p = parseAgreement("**2.1 Title.** Body text.")[0];
    expect(p.type === "paragraph" && p.text).toEqual([
      { text: "2.1 Title.", bold: true },
      { text: " Body text.", bold: false },
    ]);
  });
});

describe("the signing form's checks", () => {
  const allAcks = Object.fromEntries(ACKNOWLEDGMENTS.map((a) => [a.key, true]));
  const ready = { acknowledgments: allAcks, channels: { website: true, tcgplayer: false, ebay: false }, additionalInsurance: false, legalName: "Pat Consignor", typedSignature: "pat  consignor" };

  it("is ready when everything is answered", () => {
    expect(signingProblems(ready)).toEqual([]);
  });

  it("starts with nothing pre-selected", () => {
    expect(emptyAnswers()).toEqual({ website: null, tcgplayer: null, ebay: null });
    expect(signingProblems({ ...ready, channels: emptyAnswers(), additionalInsurance: null, acknowledgments: {}, legalName: "", typedSignature: "" })).toEqual([
      "Answer Yes or No for each sales channel.",
      "Choose whether to approve additional shipping insurance.",
      "Tick every acknowledgment.",
      "Enter your full legal name.",
    ]);
  });

  it("needs at least one channel and a matching signature", () => {
    expect(signingProblems({ ...ready, channels: { website: false, tcgplayer: false, ebay: false } })).toEqual([
      "Approve at least one sales channel, or we can't sell your cards.",
    ]);
    expect(signingProblems({ ...ready, typedSignature: "P. Consignor" })).toEqual(["Type your full legal name again, exactly, as your signature."]);
  });
});

describe("the signed PDF", () => {
  it("replaces characters the PDF font can't draw", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    expect(pdfSafe("$200.00 − $15.50 → §4 ✓ 日本", font)).toBe("$200.00 - $15.50 -> §4 Yes ??");
  });

  it("builds a multi-page PDF with the signing record", async () => {
    const bytes = await buildSignedAgreementPdf({
      consignmentNumber: 1001,
      versionNumber: 1,
      title: "Geega Games Consignment Agreement",
      renderedMd: renderAgreement(V1, ctx),
      agreementSha256: "a".repeat(64),
      recordSha256: "b".repeat(64),
      legalName: "Pat Consignor",
      typedSignature: "Pat Consignor",
      email: "pat@example.com",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      signedAt: "2026-10-28T17:04:27.000Z",
      ip: "203.0.113.9",
      userAgent: "Mozilla/5.0",
      channels: { website: true, tcgplayer: false, ebay: true },
      additionalInsurance: true,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(5);
    expect(doc.getTitle()).toBe("Geega Games Consignment Agreement - GG-C-1001");
    expect(doc.getKeywords()).toContain(`agreement-sha256:${"a".repeat(64)}`);
  });
});
