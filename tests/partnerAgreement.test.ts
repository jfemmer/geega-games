import { describe, expect, it } from "vitest";
import {
  PARTNER_AGREEMENT_ACKS,
  PARTNER_AGREEMENT_COUNTERSIGNED,
  PARTNER_AGREEMENT_VERSION,
  REFERRAL_TRACKING_DAYS,
  agreementEffectiveAt,
  countersignProblems,
  describePartnerEntity,
  parseAgreement,
  partnerAckLabel,
  partnerSigningProblems,
  referralWindow,
  renderPartnerAgreement,
  type PartnerAgreementContext,
} from "../src/store/lib/partnerAgreement";
import { PARTNER_STORE_STANDARDS } from "../src/store/lib/partnerTypes";
import { ATTRIBUTION_TTL_MS } from "../src/store/lib/attributionStore";

// The two partner agreements (src/store/lib/partnerAgreement.ts): filled in
// with the partner and fee, holding the terms the owner asked for (a referral
// fee only on a closed purchase Geega Games makes itself; nothing for a lead
// passed to a partner store; a store owes its fee on every purchase from a
// referred seller for 12 months), and parseable into the blocks the signing
// page and PDF draw. The Referral Partner Agreement is version 2 (the
// reviewed draft): countersigned by Geega Games, a 30-day Completion
// Extension, Transaction Summaries, a Missouri venue with a fallback.

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

describe("Referral Partner Agreement (version 2)", () => {
  const md = renderPartnerAgreement({ ...base, phone: "(919) 555-0100" });
  const text = flat(md);

  it("is version 2, countersigned by Geega Games", () => {
    expect(PARTNER_AGREEMENT_VERSION.referrer).toBe(2);
    expect(PARTNER_AGREEMENT_COUNTERSIGNED.referrer).toBe(true);
    expect(PARTNER_AGREEMENT_COUNTERSIGNED.store).toBe(false);
    expect(text).toContain("Version 2");
    expect(text).toContain("Effective Date | The date Geega Games countersigns this Agreement (Section 16.6)");
    expect(text).toContain("It becomes binding only when Geega Games accepts it by countersigning in Missouri");
    expect(text).toContain("Your Referral Link is activated only after both parties have signed this Agreement.");
  });

  it("names the parties, the notice contacts and the key terms", () => {
    expect(text).toContain("Geega Games LLC, a Missouri limited liability company, St. Louis, Missouri");
    expect(text).toContain("named as the Referral Partner in this Agreement's signing record, doing business as NITE Run Delivery LLC, Fuquay-Varina, NC");
    expect(text).toContain("Chayson Ingram-Gray, chay@example.com, (919) 555-0100");
    expect(text).toContain("Geega Games notice contact | support@geega-games.com");
    expect(text).toContain("Referral Fee | 3% of the Net Purchase Price (Section 5)");
    expect(text).toContain("180 days from the Referral Request, plus a 30-day Completion Extension");
    expect(text).toContain("$25 accumulated");
    // No placeholders left from the draft.
    expect(md).not.toMatch(/\[[A-Z][A-Z ]+\]/);
  });

  it("describes tracking exactly as the site does it: the link, 30 days, on the same browser", () => {
    expect(REFERRAL_TRACKING_DAYS * 86_400_000).toBe(ATTRIBUTION_TTL_MS);
    expect(text).toContain("submits a Referral Request on the same browser or device within 30 days after last opening it");
    expect(text).toContain("the later link is recorded instead");
    expect(text).not.toContain("enters your code");
  });

  it("pays only when Geega Games itself buys and the purchase closes in time", () => {
    expect(text).toContain("The Referral Fee pays you only for a successful introduction that leads to a Closed Purchase by Geega Games itself.");
    expect(text).toContain("Direct Purchase means Geega Games LLC itself acquiring title to items from a Seller");
    expect(text).toContain("the Seller was paid the final price in full");
    expect(text).toContain("The Referral Fee is 3% of the Net Purchase Price.");
    expect(text).toContain("If, within those 180 days, the Seller accepted Geega Games' written offer for the Eligible Collection, the period is extended by 30 days");
    expect(text).toContain("not counting any credit bonus");
  });

  it("owes nothing when a collection goes to a partner store or anyone else", () => {
    expect(text).toContain("a sale to a partner store, another buyer, or anyone other than Geega Games, even if Geega Games introduced them");
    expect(text).toContain("You have no claim against Geega Games, any partner store or any Seller for a fee in these cases.");
    expect(text).toContain("a Subsequent Purchase");
  });

  it("protects both sides: limits on holds, a bounded clawback, a rebuttable summary, a fee-neutral cap", () => {
    for (const phrase of [
      "Geega Games decides, in its sole discretion, all of these",
      "It may hold a payment only for these reasons",
      "for up to 60 days",
      "It will not seek repayment for events first raised more than 12 months after payment, except in cases of fraud.",
      "A Transaction Summary not questioned within 60 days is presumed accurate. You may rebut that with evidence.",
      "within 270 days after the Referral Request",
      "the greater of $500 or the Referral Fees paid or payable",
      "This cap does not reduce Referral Fees actually earned",
      "Geega Games will not end this Agreement in order to avoid paying a fee that would otherwise be earned.",
      "A new version applies to you only once you sign it.",
      "IRS Form W-9",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("covers marketing law and disclosure, with sample wording", () => {
    for (const phrase of ["16 CFR Part 255", "16 CFR Part 465", "Telephone Consumer Protection Act", "clearly and conspicuously", "Schedule A: sample fee disclosures", "Referral link: I may earn a fee."]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("disputes: Missouri law, St. Louis courts, a North Carolina fallback, no shortened time to sue, no jury waiver", () => {
    expect(text).toContain("governed by the laws of the State of Missouri");
    expect(text).toContain("St. Louis County or the City of St. Louis, Missouri");
    expect(text).toContain("N.C. Gen. Stat. § 22B-3");
    expect(text).toContain("fees awarded may not exceed the amount in controversy");
    expect(text).toContain("Nothing in this Agreement shortens any period allowed by law to bring a claim.");
    expect(text.toLowerCase()).not.toContain("jury");
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

  it("every box points at sections that exist", () => {
    const headings = parseAgreement(md)
      .filter((b) => b.type === "heading")
      .map((b) => (b.type === "heading" ? b.text.map((r) => r.text).join("") : ""));
    for (const ack of PARTNER_AGREEMENT_ACKS.referrer) {
      for (const n of ack.label.match(/Sections? ([\d.]+)(?: and ([\d.]+))?/)?.slice(1).filter(Boolean) ?? []) {
        const major = n.split(".")[0];
        expect(headings.some((h) => h.startsWith(`${major}.`)), `${ack.key} → ${n}`).toBe(true);
        if (n.includes(".")) expect(md, `${ack.key} → ${n}`).toContain(`**${n} `);
      }
    }
    expect(headings.some((h) => h.includes("Electronic signatures"))).toBe(true);
  });

  it("labels boxes from older agreements by key", () => {
    expect(partnerAckLabel("referrer", "no_store_fee")).toBe("no_store_fee");
    expect(partnerAckLabel("referrer", "countersign")).toMatch(/countersigns/);
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
  const entity = { name: "NITE Run Delivery LLC", type: "llc", state: "NC", address: "100 Main St, Fuquay-Varina, NC 27526" };

  it("is empty when everything's there, ignoring case and spacing in the signature", () => {
    expect(
      partnerSigningProblems(
        "referrer",
        { legalName: "Chayson  Ingram-Gray", title: "Owner", typedSignature: "chayson ingram-gray", acknowledgments: all, entity },
        { collectEntity: true },
      ),
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

  it("asks for the legal entity when the agreement needs it", () => {
    const problems = partnerSigningProblems(
      "referrer",
      { legalName: "Chayson Ingram-Gray", title: "Owner", typedSignature: "Chayson Ingram-Gray", acknowledgments: all, entity: { name: "", type: "", state: "", address: "1 A" } },
      { collectEntity: true },
    );
    expect(problems).toEqual([
      "Enter the legal name of the business (or your own name, if you're an individual).",
      "Choose what kind of business it is.",
      "Choose the state the business is organized in.",
      "Enter the business's mailing address.",
    ]);
  });
});

describe("countersignProblems", () => {
  it("needs a matching signature and the authority box", () => {
    expect(countersignProblems({ name: "Jacob Femmer", title: "Owner", typedSignature: "jacob  femmer", authorized: true })).toEqual([]);
    expect(countersignProblems({ name: "Jacob Femmer", title: "", typedSignature: "JF", authorized: false })).toEqual([
      "Enter your title (for example, Owner).",
      "Type your full name as your signature.",
      "Confirm you're authorized to sign for Geega Games LLC.",
    ]);
  });
});

describe("describePartnerEntity", () => {
  it("writes the entity the way a contract names it", () => {
    expect(describePartnerEntity({ name: "NITE Run Delivery LLC", type: "llc", stateName: "North Carolina" })).toBe(
      "NITE Run Delivery LLC, a North Carolina limited liability company",
    );
    expect(describePartnerEntity({ name: "Ace Cards Inc", type: "corporation", stateName: "Ohio" })).toBe("Ace Cards Inc, an Ohio corporation");
    expect(describePartnerEntity({ name: "Pat Lee", type: "individual", stateName: "Missouri" })).toBe("Pat Lee, an individual residing in Missouri");
    expect(describePartnerEntity({ name: "Club", type: "other", stateName: "Iowa" })).toBe("Club, organized in Iowa");
  });
});

describe("referralWindow", () => {
  const req = "2026-01-01T12:00:00.000Z";
  const day = (n: number) => new Date(Date.parse(req) + n * 86_400_000).toISOString();

  it("version 1: 180 days from request to close, no extension", () => {
    expect(referralWindow({ agreementVersion: 1, requestedAt: req, closedAt: day(180), offerAcceptedAt: day(10) }).ok).toBe(true);
    expect(referralWindow({ agreementVersion: 1, requestedAt: req, closedAt: day(181), offerAcceptedAt: day(10) })).toMatchObject({ ok: false, allowedDays: 180 });
  });

  it("version 2: 30 more days to close when the offer was accepted within 180 days", () => {
    expect(referralWindow({ agreementVersion: 2, requestedAt: req, closedAt: day(205), offerAcceptedAt: day(175) })).toMatchObject({
      ok: true,
      extended: true,
      allowedDays: 210,
    });
    expect(referralWindow({ agreementVersion: 2, requestedAt: req, closedAt: day(211), offerAcceptedAt: day(175) }).ok).toBe(false);
    // Accepted too late, or never: no extension.
    expect(referralWindow({ agreementVersion: 2, requestedAt: req, closedAt: day(190), offerAcceptedAt: day(185) })).toMatchObject({ ok: false, extended: false });
    expect(referralWindow({ agreementVersion: 2, requestedAt: req, closedAt: day(190), offerAcceptedAt: null }).ok).toBe(false);
    expect(referralWindow({ agreementVersion: 2, requestedAt: req, closedAt: day(100), offerAcceptedAt: null }).ok).toBe(true);
  });

  it("an agreement takes effect at the countersignature, or the signature when there's none", () => {
    expect(agreementEffectiveAt({ signed_at: "2026-11-01T00:00:00Z", countersigned_at: "2026-11-02T00:00:00Z" })).toBe("2026-11-02T00:00:00Z");
    expect(agreementEffectiveAt({ signed_at: "2026-11-01T00:00:00Z", countersigned_at: null })).toBe("2026-11-01T00:00:00Z");
  });
});
