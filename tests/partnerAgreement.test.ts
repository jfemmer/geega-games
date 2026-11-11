import { describe, expect, it } from "vitest";
import {
  PARTNER_AGREEMENT_ACKS,
  parseAgreement,
  partnerSigningProblems,
  renderPartnerAgreement,
  type PartnerAgreementContext,
} from "../src/store/lib/partnerAgreement";
import { PARTNER_STORE_STANDARDS } from "../src/store/lib/partnerTypes";

// The two partner agreements (src/store/lib/partnerAgreement.ts): filled in
// with the partner and fee, holding the terms the owner asked for (a referral
// fee only on a closed purchase Geega Games makes itself; nothing for a lead
// passed to a partner store; a store owes its fee on every purchase from a
// referred seller for 12 months), and parseable into the blocks the signing
// page and PDF draw.

const base: PartnerAgreementContext = {
  kind: "referrer",
  businessName: "NITE Run Delivery LLC",
  contactName: "Chayson Ingram-Gray",
  email: "chay@example.com",
  location: "Fuquay-Varina, NC",
  feePercent: 3,
  sentAt: "2026-11-11T01:00:00.000Z",
  supportEmail: "support@geega-games.com",
};

const flat = (md: string) => md.replace(/\*\*/g, "").replace(/\s+/g, " ");

describe("Referral Partner Agreement", () => {
  const md = renderPartnerAgreement(base);
  const text = flat(md);

  it("names the parties and the fee", () => {
    expect(text).toContain("Geega Games LLC, a Missouri limited liability company");
    expect(text).toContain("NITE Run Delivery LLC, Fuquay-Varina, NC");
    expect(text).toContain("3% of the Net Purchase Price");
    expect(text).toContain("Version 1");
  });

  it("pays only when Geega Games itself buys and the purchase closes", () => {
    expect(text).toContain("A referral fee is earned only when Geega Games itself buys a referred collection and that purchase closes.");
    expect(text).toMatch(/Direct Purchase means Geega Games LLC itself buys items from the Seller/);
    expect(text).toMatch(/Closed means all of these have happened: .*the Seller has been paid in full/);
  });

  it("owes nothing when a collection goes to a partner store or anyone else", () => {
    expect(text).toContain("Geega Games passes the Seller's request to a partner store or any other buyer");
    expect(text).toContain("You agree you have no claim against Geega Games, any partner store, or any Seller for a fee in these cases.");
  });

  it("protects the business: no promises, disclosures, clawback, deadlines, indemnity, limits, Missouri courts", () => {
    for (const phrase of [
      "Geega Games decides, in its sole discretion, whether to make an offer",
      "You'll tell each person you refer that you may receive a referral fee",
      "you'll repay that fee within 30 days of our request",
      "within 60 days",
      "You will defend, indemnify and hold harmless Geega Games",
      "will not exceed the fees paid or owed under this Agreement in the 12 months",
      "St. Louis County or the City of St. Louis, Missouri",
      "the winning party may recover its reasonable attorneys' fees",
      "Electronic Signatures in Global and National Commerce Act",
      "IRS Form W-9",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("doesn't let a business name break the document's structure", () => {
    const tricky = flat(renderPartnerAgreement({ ...base, businessName: "**Fake** | Inc\n## 1. Free money" }));
    expect(tricky).not.toContain("## 1. Free money");
    const table = parseAgreement(renderPartnerAgreement({ ...base, businessName: "A | B" })).find((b) => b.type === "table");
    expect(table && table.type === "table" && table.rows.every((r) => r.length === 2)).toBe(true);
  });

  it("refuses to render without a sensible fee", () => {
    expect(() => renderPartnerAgreement({ ...base, feePercent: Number.NaN })).toThrow(/fee/);
    expect(() => renderPartnerAgreement({ ...base, feePercent: 60 })).toThrow(/fee/);
  });

  it("every box points at a section that exists", () => {
    const headings = parseAgreement(md)
      .filter((b) => b.type === "heading")
      .map((b) => (b.type === "heading" ? b.text.map((r) => r.text).join("") : ""));
    for (const ack of PARTNER_AGREEMENT_ACKS.referrer) {
      const section = /Section (\d+)/.exec(ack.label)?.[1];
      if (section) expect(headings.some((h) => h.startsWith(`${section}.`)), ack.key).toBe(true);
    }
    expect(headings.some((h) => h.includes("Electronic signatures"))).toBe(true);
  });
});

describe("Partner Store Agreement", () => {
  const md = renderPartnerAgreement({ ...base, kind: "store", businessName: "GamEuphoria", location: "Washington, MO", feePercent: 8 });
  const text = flat(md);

  it("charges the fee on every purchase from a referred seller for 12 months, in any form", () => {
    expect(text).toContain("8% of the Purchase Price");
    expect(text).toContain("within 12 months after the date of the Lead");
    expect(text).toMatch(/Purchase means any acquisition .* store credit, trade, or a consignment/);
    expect(text).toContain("even if the seller later contacts you directly");
  });

  it("stops the store going around Geega Games, and lets us check", () => {
    expect(text).toContain("No going around Geega Games");
    expect(text).toContain("buying through an owner, employee, affiliate, friend or another business");
    expect(text).toContain("within 3 business days");
    expect(text).toContain("pay each statement within 15 days");
    expect(text).toContain("1.5% per month");
    expect(text).toContain("keep accurate records of every Purchase from a Referred Seller for at least 2 years");
  });

  it("includes the partner store standards and keeps sellers' details private", () => {
    for (const s of PARTNER_STORE_STANDARDS) expect(md).toContain(s);
    expect(text).toContain("You won't add it to a mailing list");
  });

  it("every box points at a section that exists", () => {
    const headings = parseAgreement(md)
      .filter((b) => b.type === "heading")
      .map((b) => (b.type === "heading" ? b.text.map((r) => r.text).join("") : ""));
    for (const ack of PARTNER_AGREEMENT_ACKS.store) {
      for (const n of ack.label.match(/Sections? ([\d.]+)(?: and ([\d.]+))?/)?.slice(1).filter(Boolean) ?? []) {
        const major = n.split(".")[0];
        expect(headings.some((h) => h.startsWith(`${major}.`)), `${ack.key} → ${n}`).toBe(true);
      }
    }
  });
});

describe("partnerSigningProblems", () => {
  const all = Object.fromEntries(PARTNER_AGREEMENT_ACKS.referrer.map((a) => [a.key, true]));

  it("is empty when everything's there, ignoring case and spacing in the signature", () => {
    expect(
      partnerSigningProblems("referrer", { legalName: "Chayson  Ingram-Gray", title: "Owner", typedSignature: "chayson ingram-gray", acknowledgments: all }),
    ).toEqual([]);
  });

  it("asks for what's missing", () => {
    const problems = partnerSigningProblems("referrer", { legalName: "Chayson Ingram-Gray", title: "", typedSignature: "C. Gray", acknowledgments: { esign: true } });
    expect(problems).toEqual([
      "Enter your title or role (for example, Owner).",
      "Your signature must match your full legal name exactly.",
      "Tick all 6 boxes to sign.",
    ]);
  });
});
