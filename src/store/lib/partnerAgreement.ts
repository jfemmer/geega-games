// The partner program's two agreements, signed electronically when the owner
// approves a partner:
//
//   referrer  Referral Partner Agreement (version 2): a referral fee only when
//             Geega Games itself buys a referred collection and the purchase
//             closes. No fee when a lead is passed to a partner store or sold
//             elsewhere. The partner signs first, with their legal entity
//             details; it takes effect when Geega Games countersigns.
//   store     Partner Store Agreement (version 1): the finder's fee a partner
//             store owes Geega Games on every purchase from a seller it was
//             sent, including later purchases (no going around Geega Games).
//
// The text lives here, versioned. Sending an agreement renders the template
// with the partner's details and fee, and the server freezes that text with
// its SHA-256 (partner_agreements). A material change is a new version, which
// partners sign again; an agreement already signed keeps its own frozen text.
// The signing page and the signed PDF both draw from parseAgreement(), so the
// PDF shows exactly what was signed.
//
// Pure module: no React, browser, Node or Supabase imports.

import { PARTNER_STORE_STANDARDS, type PartnerKind } from "./partnerTypes.js";

// Same markdown subset and parser as the consignment agreement.
export { parseAgreement, type AgreementBlock, type Inline } from "./consignmentAgreement.js";

export const PARTNER_AGREEMENT_VERSION: Record<PartnerKind, number> = { referrer: 2, store: 1 };

export const PARTNER_AGREEMENT_TITLE: Record<PartnerKind, string> = {
  referrer: "Geega Games Referral Partner Agreement",
  store: "Geega Games Partner Store Agreement",
};

/**
 * Agreements Geega Games countersigns: the partner signs first (with their
 * legal entity details) and the agreement takes effect, and the partner goes
 * live, only when the owner countersigns (Referral Partner Agreement 16.6).
 */
export const PARTNER_AGREEMENT_COUNTERSIGNED: Record<PartnerKind, boolean> = { referrer: true, store: false };

/** Days a signing link stays open. */
export const PARTNER_AGREEMENT_INVITE_DAYS = 14;

/** Months after a lead during which a partner store owes the finder's fee on any purchase from that seller. */
export const STORE_FEE_TAIL_MONTHS = 12;

/** Days after a referral (the seller's request) during which a closed purchase still earns the referral fee. */
export const REFERRAL_WINDOW_DAYS = 180;

/**
 * Extra days to close when the seller accepted Geega Games' offer within
 * REFERRAL_WINDOW_DAYS (version 2, section 2.12).
 */
export const REFERRAL_COMPLETION_EXTENSION_DAYS = 30;

/**
 * Days a referral link keeps crediting a seller on the same browser after they
 * last opened it (version 2, section 2.4). Must match ATTRIBUTION_TTL_MS in
 * attributionStore.ts (tests/partnerAgreement.test.ts checks).
 */
export const REFERRAL_TRACKING_DAYS = 30;

/** Earned fees are paid once the unpaid balance reaches this (version 2, section 6.2). */
export const REFERRAL_MIN_PAYOUT_DOLLARS = 25;

/** Days to raise a question about a fee after its Transaction Summary or payment (version 2, section 6.6). */
export const REFERRAL_FEE_QUESTION_DAYS = 60;

export interface PartnerAgreementAck {
  key: string;
  label: string;
}

const ESIGN_ACK: PartnerAgreementAck = {
  key: "esign",
  label: "I consent to use electronic records and signatures, as described in the Electronic signatures section.",
};
const REVIEWED_ACK: PartnerAgreementAck = {
  key: "reviewed",
  label: "I have read this entire agreement and I'm authorized to sign it for the business named above.",
};

/** Every box must be ticked to sign. */
export const PARTNER_AGREEMENT_ACKS: Record<PartnerKind, readonly PartnerAgreementAck[]> = {
  referrer: [
    {
      key: "esign",
      label: "I agree to sign this agreement and receive notices, statements and records electronically (Section 17).",
    },
    {
      key: "reviewed",
      label: "I have read this entire agreement and I'm authorized to sign it for the legal entity I name below (Section 3.3).",
    },
    {
      key: "direct_purchase",
      label:
        "I understand a fee is earned only when Geega Games itself buys a collection I referred and the purchase closes in time, and never for a sale to a partner store or anyone else (Sections 5.1 and 5.3).",
    },
    {
      key: "conduct",
      label:
        "I'll promote the program only as this agreement allows: no spam, cold texts or robocalls, no promises for Geega Games, and a clear disclosure of my fee (Section 7).",
    },
    { key: "taxes", label: "I'm responsible for my own taxes and will provide a W-9 before my first payment (Sections 6.4 and 10)." },
    {
      key: "countersign",
      label: "I understand this agreement takes effect, and my referral link turns on, only when Geega Games countersigns it (Sections 3.4 and 16.6).",
    },
  ],
  store: [
    ESIGN_ACK,
    REVIEWED_ACK,
    {
      key: "finders_fee",
      label: `I understand the finder's fee is owed on every purchase from a seller Geega Games sent us, for ${STORE_FEE_TAIL_MONTHS} months after the lead (Section 4).`,
    },
    {
      key: "reporting",
      label: "We'll report every purchase within 3 business days and pay each statement within 15 days (Sections 4.4 and 4.5).",
    },
    {
      key: "no_circumvention",
      label: "We won't avoid the fee by buying through someone else, splitting or delaying a purchase (Section 5).",
    },
    { key: "seller_data", label: "We'll use a seller's details only to make that seller an offer (Section 6)." },
  ],
};

/** A label for a ticked box's key, for agreements signed under an older list. */
export function partnerAckLabel(kind: PartnerKind, key: string): string {
  return PARTNER_AGREEMENT_ACKS[kind].find((a) => a.key === key)?.label ?? key;
}

// ---------------------------------------------------------------- the partner's legal entity

/** What kind of legal person signs (version 2, section 3.1). */
export const PARTNER_ENTITY_TYPES = [
  { value: "individual", label: "Individual or sole proprietor" },
  { value: "llc", label: "Limited liability company (LLC)" },
  { value: "corporation", label: "Corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "other", label: "Other" },
] as const;

export type PartnerEntityType = (typeof PARTNER_ENTITY_TYPES)[number]["value"];

export function isPartnerEntityType(v: unknown): v is PartnerEntityType {
  return typeof v === "string" && PARTNER_ENTITY_TYPES.some((t) => t.value === v);
}

export function partnerEntityTypeLabel(v: string | null | undefined): string {
  return PARTNER_ENTITY_TYPES.find((t) => t.value === v)?.label ?? (v || "");
}

export interface PartnerEntityInput {
  /** Legal name of the business, or the person's own name for an individual. */
  name: string;
  type: string;
  /** Two-letter state of organization (or of residence, for an individual). */
  state: string;
  address: string;
}

/** "Acme Cards LLC, a Missouri limited liability company" — for the signing record. */
export function describePartnerEntity(e: { name: string; type: string; stateName: string | null }): string {
  const where = e.stateName ?? "";
  if (e.type === "individual") return `${e.name}, an individual${where ? ` residing in ${where}` : ""}`;
  if (!isPartnerEntityType(e.type) || e.type === "other") return `${e.name}${where ? `, organized in ${where}` : ""}`;
  const type = partnerEntityTypeLabel(e.type).replace(/\s*\(.*\)$/, "").toLowerCase();
  const phrase = `${where ? `${where} ` : ""}${type}`;
  return `${e.name}, ${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

// ---------------------------------------------------------------- rendering

export interface PartnerAgreementContext {
  kind: PartnerKind;
  businessName: string;
  contactName: string;
  email: string;
  phone?: string | null;
  /** City, ST — or null. */
  location: string | null;
  feePercent: number;
  /** ISO date the agreement was sent. */
  sentAt: string;
  supportEmail: string;
}

/** "3%" / "7.5%" */
export function formatFeePercent(n: number): string {
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))}%`;
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
}

/** Strip characters that would change the agreement's markdown structure. */
function plain(s: string): string {
  return s.replace(/[*|#\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

const GEEGA_PARTY = `Geega Games LLC, a Missouri limited liability company, St. Louis, Missouri ("**Geega Games**", "we", "us")`;

function partiesTable(ctx: PartnerAgreementContext, partnerLabel: string): string {
  return [
    "| Term | Details |",
    "| --- | --- |",
    `| Geega Games | ${GEEGA_PARTY} |`,
    `| ${partnerLabel} | ${plain(ctx.businessName)}${ctx.location ? `, ${plain(ctx.location)}` : ""} ("**${partnerLabel}**", "you") |`,
    `| Contact | ${plain(ctx.contactName)}, ${plain(ctx.email)} |`,
    `| ${ctx.kind === "store" ? "Finder's fee" : "Referral fee"} | ${formatFeePercent(ctx.feePercent)} ${
      ctx.kind === "store" ? "of the Purchase Price (Section 4)" : "of the Net Purchase Price (Section 4)"
    } |`,
    `| Sent | ${longDate(ctx.sentAt)}. This Agreement takes effect when you sign it (the "**Effective Date**"). |`,
  ].join("\n");
}

function commonTerms(ctx: PartnerAgreementContext, n: { first: number }): string {
  const s = n.first;
  return `## ${s}. Liability and indemnity

**${s}.1 Indemnity.** You will defend, indemnify and hold harmless Geega Games and its owners, employees and agents from any claim, loss, liability, penalty, cost or expense (including reasonable attorneys' fees) arising from your breach of this Agreement, your statements to or dealings with any seller, your violation of any law, or your negligence or misconduct.

**${s}.2 Limit of our liability.** To the fullest extent the law allows, Geega Games is not liable to you for any indirect, incidental, special, consequential or punitive damages, or for lost profits or lost business, and our total liability under or relating to this Agreement will not exceed the fees paid or owed under this Agreement in the 12 months before the claim arose.

**${s}.3 No warranties.** The program, referral links, materials and leads are provided "as is." We don't promise any number of leads, referrals, purchases or fees.

## ${s + 1}. Term and ending the Agreement

**${s + 1}.1 Term.** This Agreement starts on the Effective Date and continues until either of us ends it.

**${s + 1}.2 Ending it.** Either of us may end this Agreement at any time, for any reason, by email. We may also pause your participation at any time. We may end it immediately if you breach it, act dishonestly, or do anything that we reasonably believe could harm Geega Games' reputation, customers or sellers.

**${s + 1}.3 After it ends.** Sections that by their nature should continue, including fees already owed, records, confidentiality, indemnity, limits of liability and disputes, survive the end of this Agreement.

## ${s + 2}. General terms

**${s + 2}.1 Independent businesses.** We are independent businesses. Nothing in this Agreement makes either of us the other's employee, agent, partner or joint venturer. You have no authority to make offers, set prices, sign documents, accept property or make any promise on Geega Games' behalf, and you won't say or suggest that you do.

**${s + 2}.2 Non-exclusive.** This Agreement is non-exclusive. Geega Games may work with other partners, stores and referrers anywhere, including near you.

**${s + 2}.3 Our name and marks.** You may use the Geega Games name, logo and materials only as we provide them and only to take part in this program. That permission ends when this Agreement ends.

**${s + 2}.4 Changes.** We may change the program or this Agreement by sending you a new version by email at least 30 days before it takes effect. A change to your fee applies only to leads or referrals made after the change takes effect. If you don't accept a new version, you may end this Agreement; continuing to take part after the effective date means you accept it. Any other change must be in writing and agreed by both of us.

**${s + 2}.5 Assignment.** You may not assign or transfer this Agreement, or any fee under it, without our written consent. We may assign it to a successor to our business.

**${s + 2}.6 Notices.** Notices under this Agreement may be sent by email: to you at ${plain(ctx.email)} (or a newer address you give us in writing), and to us at ${plain(ctx.supportEmail)}.

**${s + 2}.7 Disputes.** Each of us agrees to try to resolve any dispute informally first, by written notice and at least 30 days of good-faith discussion. This Agreement is governed by the laws of the State of Missouri, without regard to its conflict-of-law rules. Any lawsuit must be brought in the state or federal courts located in St. Louis County or the City of St. Louis, Missouri, and each of us consents to those courts' jurisdiction. In any lawsuit to enforce this Agreement or collect money owed under it, the winning party may recover its reasonable attorneys' fees and costs.

**${s + 2}.8 Whole agreement.** This Agreement is the entire agreement between us about the partner program and replaces any earlier discussions, emails or promises about it. If a court finds part of it unenforceable, that part will be enforced as far as the law allows and the rest stays in effect. Not enforcing a term is not a waiver of it.

## ${s + 3}. Electronic signatures

**${s + 3}.1 Consent.** By consenting, you agree that this Agreement, notices, statements and other records may be provided to you electronically, and that your electronic signature has the same effect as a handwritten one under the federal Electronic Signatures in Global and National Commerce Act (15 U.S.C. § 7001 et seq.) and the Missouri Uniform Electronic Transactions Act (Mo. Rev. Stat. §§ 432.200–432.295). You may ask for a paper copy at no charge by emailing ${plain(ctx.supportEmail)}, and you may withdraw this consent by email at any time, which ends this Agreement but does not affect fees or records already in place.

**${s + 3}.2 What we record.** When you sign, we keep with this Agreement: the full text and version shown to you; your typed full legal name, title and signature; each box you ticked; the date and time; the email address the signing link was sent to; and technical information about the signing session, including IP address and browser. We make a PDF of the signed Agreement with this information and a SHA-256 fingerprint of the text, so any later change can be detected, and email you a copy.`;
}

// Referral Partner Agreement, version 2 (reviewed draft, November 2026).
function referrerTemplate(ctx: PartnerAgreementContext): string {
  const fee = formatFeePercent(ctx.feePercent);
  const days = REFERRAL_WINDOW_DAYS;
  const ext = REFERRAL_COMPLETION_EXTENSION_DAYS;
  const track = REFERRAL_TRACKING_DAYS;
  const min = `$${REFERRAL_MIN_PAYOUT_DOLLARS}`;
  const q = REFERRAL_FEE_QUESTION_DAYS;
  const contact = [plain(ctx.contactName), plain(ctx.email), ctx.phone ? plain(ctx.phone) : null].filter(Boolean).join(", ");
  const dba = `${plain(ctx.businessName)}${ctx.location ? `, ${plain(ctx.location)}` : ""}`;
  return `# ${PARTNER_AGREEMENT_TITLE.referrer}

Version ${PARTNER_AGREEMENT_VERSION.referrer}

**Key terms**

| Term | Details |
| --- | --- |
| Geega Games | ${GEEGA_PARTY} |
| Referral Partner | The person or legal entity named as the Referral Partner in this Agreement's signing record, doing business as ${dba} ("**Partner**", "you") |
| Partner notice contact | ${contact} |
| Geega Games notice contact | ${plain(ctx.supportEmail)} |
| Referral Fee | ${fee} of the Net Purchase Price (Section 5) |
| Referral Attribution Period | ${days} days from the Referral Request, plus a ${ext}-day Completion Extension in the case described in Section 2.12 |
| Tracking window | A Seller's request is credited if submitted within ${track} days after the Seller last opened your Referral Link on the same browser or device (Section 2.4) |
| Minimum payout | ${min} accumulated (Section 6.2) |
| Sent | ${longDate(ctx.sentAt)} |
| Effective Date | The date Geega Games countersigns this Agreement (Section 16.6) |

## 1. Purpose and nature of the fee

**1.1 Purpose.** You want to introduce people who own trading cards, games or collections to Geega Games. This Agreement sets out when you earn a fee for a successful introduction, how much it is, and how it is paid.

**1.2 A fee for an introduction only.** The Referral Fee pays you only for a successful introduction that leads to a Closed Purchase by Geega Games itself. You do not negotiate, broker, appraise, authenticate or complete any purchase, and no fee is payable for any such activity.

**1.3 Non-exclusive.** This Agreement is non-exclusive. Each of us may work with anyone else, anywhere.

## 2. Definitions

**2.1 Seller** means a person or business that owns items and asks Geega Games for an offer.

**2.2 Referral Link** means the unique link, code or QR code Geega Games issues to you. Geega Games may replace or deactivate it.

**2.3 Referral Request** means a Seller's own request for an offer, submitted to Geega Games through its website or another channel Geega Games designates.

**2.4 Tracking Method** means Geega Games' system for recording your code with a Referral Request. A request is recorded with your code when the Seller opens your Referral Link and then submits a Referral Request on the same browser or device within ${track} days after last opening it. If the Seller opens someone else's referral link before submitting, the later link is recorded instead. Any other method counts only if Geega Games approves it in writing for a specific Seller before that Seller's request.

**2.5 Eligible Collection** means the specific items described in the Referral Request, including its photos, lists and descriptions. It also includes items the Seller adds to the same request before Geega Games issues its final written offer for it.

**2.6 Existing Lead** means a Seller who, in the 12 months before the Referral Request, did any of the following:

- contacted Geega Games about the same items
- had an open request with Geega Games
- sold items to Geega Games

It also means a Seller with whom Geega Games already had documented contact about the same items.

**2.7 Duplicate Referral** means a Referral Request for a Seller and items already recorded as referred, by you or anyone else, or a second request for the same items.

**2.8 Qualified Referral** means a Referral Request that meets all of these conditions:

1. it was recorded by the Tracking Method during the Term, while you were active in the program;
2. the Seller is not an Existing Lead;
3. it is not a Duplicate Referral; the first recorded request wins;
4. the Seller is not you, your owners, employees, contractors or affiliates, a member of their household, or anyone acting for any of them;
5. the Seller submitted it voluntarily, with any information about them shared with their permission; and
6. it was not obtained in breach of this Agreement.

**2.9 Direct Purchase** means Geega Games LLC itself acquiring title to items from a Seller, in its own name and for its own account, under an offer Geega Games makes and the Seller accepts.

A Direct Purchase does not include any of these:

- consignment
- a trade or exchange of merchandise
- a sale to a partner store or any other buyer
- any arrangement other than an outright purchase

**2.10 Closed Purchase** means a Direct Purchase in which all of these have happened:

1. Geega Games received the items;
2. Geega Games inspected and accepted them;
3. the Seller was paid the final price in full; and
4. no cancellation, refund, chargeback, payment reversal, or claim that the items are stolen, counterfeit or not the Seller's to sell is pending.

**2.11 Net Purchase Price** means the merchandise price Geega Games paid the Seller for items in the Eligible Collection that it bought and kept in a Closed Purchase. It is taken from the final itemized offer accepted after inspection.

- **Expenses are excluded either way.** Shipping, insurance, packaging, labels, taxes and payment-processing fees are not added to it. Any amount deducted from the Seller's payout for those costs does not reduce it.
- **Store credit or trade credit.** If the Seller is paid this way, the Net Purchase Price is the cash price Geega Games offered for the same items, not counting any credit bonus.
- **Returned and problem items.** Items returned, refunded, rejected, or found to be counterfeit, stolen or significantly misrepresented are excluded.

**2.12 Referral Attribution Period and Completion Extension.** The Referral Attribution Period is ${days} days starting on the date of the Referral Request. If, within those ${days} days, the Seller accepted Geega Games' written offer for the Eligible Collection, the period is extended by ${ext} days (the "**Completion Extension**"). The extension applies only to closing the purchase of the items in that accepted offer.

**2.13 Installment Purchase** means Geega Games buying the Eligible Collection in documented parts under the same accepted offer, or under an offer that expressly covers the Eligible Collection in stages.

**2.14 Subsequent Purchase** means either of these:

- any purchase from the same Seller of items outside the Eligible Collection
- any purchase that closes after the Referral Attribution Period and any Completion Extension

**2.15 Referral Fee** means the fee in Section 5.2.

**2.16 Transaction Summary** means Geega Games' written statement of an earned fee: the request reference number, closing date, Net Purchase Price and fee.

**2.17 Confidential Information** has the meaning in Section 9.1.

**2.18 Program Materials** means the links, QR codes, flyers, logos and wording Geega Games provides for the program.

## 3. Onboarding and activation

**3.1 Your information.** You will give Geega Games accurate information:

- your legal entity name, state of organization and business address
- a contact person and your website or social accounts
- the name and title of the person signing
- your payment details

Tell us of any change within 10 days.

**3.2 Verification.** Geega Games may verify your identity and business. It may decline, suspend or end your participation if it cannot.

**3.3 Authority to sign.** The person signing for you confirms they are authorized to bind you to this Agreement.

**3.4 Activation.** Your Referral Link is activated only after both parties have signed this Agreement. Requests made before activation do not qualify.

## 4. How referrals work

**4.1 Sellers submit their own requests.** You may share your Referral Link with people who want an offer. Each Seller submits their own Referral Request. You may help a Seller fill in the form only with them present and with their consent. You will never submit a Seller's information without their permission.

**4.2 Tracking.** Only the Tracking Method establishes attribution. Claims made outside it are not considered unless Geega Games agreed in writing before the Seller's request.

**4.3 One partner per collection.** Only one partner is credited for an Eligible Collection: the one whose Qualified Referral was recorded first. Geega Games' records decide attribution, subject to the review process in Section 6.6.

**4.4 Geega Games' control.** Geega Games decides, in its sole discretion, all of these:

- whether to contact a Seller, and when
- whether to make an offer, and how much to offer
- authentication, inspection, acceptance, negotiation and payment terms

It may decline any Seller, pass a Seller's request to a partner store, or stop negotiating at any time. It has no obligation to make an offer or buy anything, and there is no minimum volume.

**4.5 Seller information.** Geega Games does not share Sellers' identities, communications, offers or evaluations with you, except as stated in a Transaction Summary.

## 5. The Referral Fee

**5.1 When a fee is earned.** A Referral Fee is earned only when all of these are true:

1. the request is a Qualified Referral;
2. Geega Games makes a Direct Purchase of all or part of the Eligible Collection;
3. the purchase is a Closed Purchase;
4. it closes within the Referral Attribution Period or any Completion Extension; and
5. you are not in material breach of this Agreement in connection with that referral.

**5.2 Amount.** The Referral Fee is **${fee} of the Net Purchase Price**.

- **Partial purchases.** If Geega Games buys only part of the Eligible Collection, the fee is based only on the items it bought and kept.
- **Installment Purchases.** Each installment earns a fee if it closes within the Referral Attribution Period or any Completion Extension.
- **One fee per item.** No item earns more than one fee, and only one partner is paid for it.

**5.3 When no fee is owed.** No Referral Fee is owed, by Geega Games or anyone else, for any of the following:

1. the Seller doesn't sell, declines an offer, or Geega Games makes no offer;
2. a sale to a partner store, another buyer, or anyone other than Geega Games, even if Geega Games introduced them;
3. consignment, trade or exchange, unless Geega Games agrees otherwise in writing for that Seller;
4. a Subsequent Purchase;
5. an Existing Lead, a Duplicate Referral, or a self-referral;
6. a purchase that closes after the Referral Attribution Period and any Completion Extension;
7. items rejected, returned, refunded, or found to be counterfeit, stolen or significantly misrepresented; or
8. a referral connected with fraud, material misrepresentation, or your breach of this Agreement.

You have no claim against Geega Games, any partner store or any Seller for a fee in these cases.

**5.4 Changes after inspection.** The Net Purchase Price uses the final price accepted after inspection. If the price is later reduced because items are found counterfeit, stolen or misrepresented, the fee is recalculated on the reduced price.

**5.5 Reversals and corrections.** A fee is not earned on any affected items, and you will repay it within 30 days of Geega Games' written request, if either of these happens:

- a fee was paid in error
- within 12 months after a fee was paid, the purchase is cancelled, refunded, reversed or charged back, or items are found stolen, counterfeit or not the Seller's to sell

Geega Games may instead deduct the amount from future fees. It will not seek repayment for events first raised more than 12 months after payment, except in cases of fraud.

**5.6 No manipulation.** Neither party will split, delay, re-label or restructure a purchase to avoid or create a fee. Geega Games will not treat a Direct Purchase as a consignment or trade to avoid a fee. You will not encourage a Seller to split, delay or resubmit a request.

## 6. Payment, records and fee questions

**6.1 When paid.** Earned fees are paid within 30 days after the end of the month in which the purchase closes.

**6.2 Minimum payout.** Earned fees are paid once your unpaid balance reaches ${min}; smaller balances carry forward. After this Agreement ends, any valid balance is paid in full under Section 14.6, whatever its size.

**6.3 Method.** Geega Games pays by a method it chooses, such as ACH, check or PayPal, to the legal entity named in the signing record.

**6.4 Tax documents and withholding.** You will provide a completed IRS Form W-9 before your first payment. Geega Games may hold payments until it receives one, without interest. Geega Games will withhold tax only when required by law, including backup withholding.

**6.5 Limits on holding valid fees.** Geega Games pays undisputed earned fees on schedule. It may hold a payment only for these reasons:

1. while waiting for your W-9 or payment details;
2. for a fee under good-faith review for fraud or eligibility, after notifying you in writing, for up to 60 days, or longer only while a related legal proceeding or law-enforcement inquiry is open;
3. to offset amounts you owe Geega Games under this Agreement; or
4. as required by law.

**6.6 Transaction Summaries and fee questions.** Geega Games will email a Transaction Summary for each earned fee and a statement with each payment.

- **Raising a question.** Please raise any question about a fee, or a referral you believe qualified, in writing within ${q} days after the related Transaction Summary or payment. If no summary was sent, raise it within ${days + ext + q} days after the Referral Request. This lets it be checked while records are fresh.
- **Review and response.** Geega Games will review in good faith and respond in writing within 30 days, confirming the relevant facts. These are: whether a request was recorded, whether a Direct Purchase closed, the closing date, and the Net Purchase Price.
- **What isn't shared.** Geega Games need not disclose Sellers' identities, communications, offers, evaluations or pricing methods.
- **Presumption.** A Transaction Summary not questioned within ${q} days is presumed accurate. You may rebut that with evidence.
- **Further disputes.** Unresolved questions go to Section 16. Nothing here shortens any time allowed by law to bring a claim.

## 7. Marketing and conduct

**7.1 Compliance with law.** You will comply with all laws that apply to your promotion of the program. These include:

- the FTC Act and the FTC's Guides Concerning the Use of Endorsements and Testimonials in Advertising (16 CFR Part 255)
- the FTC's rule on consumer reviews and testimonials (16 CFR Part 465)
- the CAN-SPAM Act, the Telephone Consumer Protection Act and the Telemarketing Sales Rule
- state telemarketing, consumer-protection and privacy laws

**7.2 Prohibited conduct.** You will not, directly or through anyone else:

1. impersonate Geega Games, or claim to be its employee, agent or authorized buyer;
2. negotiate prices for Geega Games, or promise or estimate any offer, payment or timeline;
3. accept, hold, ship, pay for, or buy merchandise on Geega Games' behalf;
4. submit a Seller's information without their lawful permission;
5. use purchased, rented or scraped contact lists;
6. send unsolicited commercial email or text messages, or make telemarketing calls or automated calls or texts, to promote the program;
7. make false, misleading or unsubstantiated claims, or post fake reviews or testimonials;
8. bid on "Geega Games" or similar terms in paid search without written approval;
9. create domains, profiles, accounts or ads that could be confused with Geega Games;
10. create fake, duplicate or self-generated referrals, or manipulate attribution;
11. encourage Sellers to inflate prices or misdescribe merchandise; or
12. operate sub-affiliates or pay others to refer Sellers without written approval.

**7.3 Disclosure of your fee.** Whenever your financial relationship with Geega Games could affect how people weigh your recommendation, disclose it clearly and conspicuously:

- near the recommendation or link
- in the same medium
- not hidden behind "more", a hashtag list, or a separate page

Schedule A gives sample wording. If your profession has its own rules on referral fees, Section 7.8 also applies.

**7.4 Advertising approval.** Get Geega Games' written approval before using either of these:

- paid advertising that mentions Geega Games
- material using Geega Games' name or logo other than unchanged Program Materials

Geega Games will try to answer within 5 business days. No answer means not approved. Ordinary posts sharing your link with the disclosure in Section 7.3 need no approval.

**7.5 Corrections and removal.** If Geega Games asks you in writing to correct or remove any content about the program, you will do so within these times:

- unlawful or deceptive content: within 24 hours
- anything else: within 48 hours

**7.6 Your personnel.** You are responsible for your owners', employees' and contractors' compliance with this Agreement.

**7.7 No subcontracting.** You may not delegate or subcontract your activities under this Agreement without Geega Games' written approval.

**7.8 Conflicts of interest and professional duties.**

- **Tell us about card buying or selling.** Tell Geega Games in writing if you or your affiliates buy, sell or consign trading cards, games or collections.
- **Your own business.** You may run your own business. But you will not refer a Seller to Geega Games while you or an affiliate is negotiating to buy the same items. You will not use anything learned through the program to outbid or interfere with an active Geega Games purchase.
- **Professional rules.** If you are an attorney, real estate agent, fiduciary, or anyone else whose profession limits referral fees or requires disclosure, you will follow those rules. You confirm you are allowed to accept these fees.

## 8. Name, marks and materials

**8.1 Limited license.** Geega Games gives you a limited license to use its name and the Program Materials, only to promote this program and only as provided. The license is non-exclusive, revocable and non-transferable.

**8.2 Restrictions.** You will not alter the Program Materials or register any domain, handle or business name containing "Geega". All goodwill from use of Geega Games' marks belongs to Geega Games.

**8.3 End of use.** The license ends when this Agreement ends or when Geega Games revokes it. You will stop using and remove the marks and Program Materials within 10 days.

## 9. Confidentiality and data security

**9.1 Confidential Information** means nonpublic information you learn through the program. This includes:

- Seller contact information and communications
- collection evaluations and authentication findings
- purchase offers, internal buying criteria and pricing methods
- referral-tracking information and nonpublic business processes

**9.2 Use.** You will use Confidential Information only to take part in this program. You will share it only with personnel who need it and are bound by similar duties. You will never use it to interfere with an active Geega Games purchase.

**9.3 Exclusions.** Confidential Information does not include information that is any of these:

- public through no fault of yours
- already known to you
- independently developed
- rightfully received from someone without a duty of confidence

**9.4 Legally required disclosure.** You may disclose Confidential Information when the law requires it, after notifying Geega Games where lawful.

**9.5 Minimum necessary.** Geega Games will share only what is reasonably needed to administer your fees: reference numbers, dates and amounts.

**9.6 Security and incidents.** You will protect Confidential Information with reasonable administrative, technical and physical safeguards. You will notify Geega Games within 72 hours after discovering any unauthorized access or disclosure, and cooperate in responding.

**9.7 Return or deletion.** Within 10 days after this Agreement ends, or on request, you will return or delete Confidential Information, and confirm in writing if asked. The only exception is what the law requires you to keep.

**9.8 Duration; no noncompete.** These duties last 3 years after this Agreement ends. For Sellers' personal information and trade secrets, they last as long as the information stays protected. Nothing in this Agreement stops you from conducting a lawful, independent business, subject to Sections 7.8 and 9.2.

## 10. Independent businesses and taxes

**10.1 Independent businesses.** You and Geega Games are independent businesses. This Agreement creates no employment, agency, partnership, joint venture or franchise. You control how you carry out your own activities. You have no authority to bind Geega Games.

**10.2 No benefits.** You receive no wages and no employee benefits, insurance or reimbursement.

**10.3 Taxes.** Each party is responsible for its own taxes. You are responsible for all taxes on fees you receive. Geega Games withholds only when required by law.

**10.4 Information reporting.** Geega Games will file Form 1099-NEC or other information returns when the law requires.

**10.5 Actual conduct.** The parties understand that independent-contractor status depends on how the relationship actually operates, not only on this Agreement's words. Each will conduct the relationship consistently with it.

## 11. Representations

**11.1 Yours.** You represent all of these:

- you are validly organized and in good standing
- you are authorized to sign
- your information is accurate
- you hold any licenses your own business requires
- nothing prevents you from performing this Agreement

**11.2 Geega Games'.** Geega Games represents that it is a Missouri limited liability company in good standing and is authorized to sign.

## 12. Indemnification

**12.1 By you.** You will defend, indemnify and hold harmless Geega Games and its owners, employees and agents. This covers third-party claims, losses, penalties and reasonable attorneys' fees arising from any of these:

1. unlawful marketing or outreach;
2. your misrepresentations;
3. fraudulent or manipulated referrals;
4. mishandling of Confidential Information or personal data, or privacy violations;
5. intellectual-property infringement, except by Program Materials used as provided;
6. unauthorized negotiation, or handling of Sellers' property;
7. your negligence or misconduct; or
8. your breach of this Agreement.

**12.2 By Geega Games.** Geega Games will defend and indemnify you against third-party claims that Program Materials, used exactly as provided, infringe intellectual-property rights.

**12.3 Procedure.**

- **Notice.** The protected party will give prompt written notice of a claim. A delay excuses the other party only to the extent it is prejudiced.
- **Defense.** The indemnifying party controls the defense with counsel reasonably acceptable to the protected party. The protected party may take part at its own cost.
- **Settlement.** No settlement may admit fault for, or impose obligations on, the protected party without its consent.
- **Failure to defend.** If the indemnifying party does not take up the defense within 15 days after notice, the protected party may defend at the indemnifying party's expense.

## 13. Limitation of liability

**13.1 No indirect damages.** Neither party is liable for indirect, incidental, special, consequential or punitive damages, or lost profits.

**13.2 Geega Games' cap.** Geega Games' total liability under this Agreement will not exceed the greater of $500 or the Referral Fees paid or payable to you in the 12 months before the claim. **This cap does not reduce Referral Fees actually earned under Sections 5 and 6; those are payable in full.**

**13.3 Exceptions.** Sections 13.1 and 13.2 do not apply to:

- indemnity obligations
- breach of Section 9
- your repayment obligations
- fraud or willful misconduct
- liability that cannot be limited by law

## 14. Term, suspension and termination

**14.1 Term.** This Agreement starts on the Effective Date and continues until ended (the "**Term**").

**14.2 Ending for any reason.** Either party may end this Agreement at any time by written notice, including email. It takes effect on receipt or on a later date stated in the notice.

**14.3 Immediate suspension or termination.** Geega Games may suspend your Referral Link or end this Agreement immediately, by notice, for any of these:

1. fraud;
2. material breach;
3. unlawful marketing;
4. serious misrepresentation;
5. handling Sellers' property;
6. misuse of Confidential Information; or
7. conduct that creates a significant risk to Geega Games' reputation.

**14.4 During suspension.** While suspended, your Referral Link is inactive and new requests do not qualify. Referrals already recorded are handled under Section 14.5.

**14.5 Pending referrals.**

- **Still eligible.** Qualified Referrals recorded before termination or suspension remain eligible if the purchase closes within the Referral Attribution Period and any Completion Extension.
- **New requests.** Requests made after termination do not qualify.
- **Exception.** No fee is owed on a referral connected with fraud, material misrepresentation, or a breach of this Agreement related to that referral.
- **Good faith.** Geega Games will not end this Agreement in order to avoid paying a fee that would otherwise be earned.

**14.6 After termination.** You will:

- stop using your Referral Link and Geega Games' marks
- remove program content within 10 days
- return or delete Confidential Information under Section 9.7

Geega Games will pay all valid earned fees within 30 days after the end of the month in which the last eligible purchase closes or all attribution periods end, whichever is first. The ${min} minimum does not apply.

**14.7 Survival.** These Sections survive termination: 5.3–5.6, 6, 8.3, 9, 10, 12, 13, 14.5–14.7, 16, 17 and 18.

## 15. Program terms and changes

**15.1 Order of precedence.** The program pages, FAQs and emails are informational. If they conflict with this Agreement, the following control in this order:

1. this signed Agreement
2. any signed amendment
3. Schedule A
4. online program terms

**15.2 New versions.** Geega Games may offer a new version of this Agreement by email at least 30 days before it is to take effect.

- **Takes effect only when signed.** A new version applies to you only once you sign it.
- **Until then.** Geega Games may suspend your Referral Link for new requests until you sign.
- **Earlier referrals.** Referrals recorded before a new version takes effect stay under the version in force when they were recorded.

**15.3 Other amendments.** Any other change must be in writing and signed by both parties.

## 16. Disputes, governing law and venue

**16.1 Governing law.** This Agreement is governed by the laws of the State of Missouri, without regard to its conflict-of-law rules.

**16.2 Informal resolution first.** Before filing a claim, the party with the dispute will send written notice describing it. The parties' decision-makers will discuss it in good faith for at least 30 days. This does not prevent a party from seeking urgent relief to protect Confidential Information or intellectual property, or from filing to preserve a claim.

**16.3 Small claims.** Either party may bring an individual claim in a small claims court that has jurisdiction, either in St. Louis County or the City of St. Louis, Missouri, or in the county of the other party's principal place of business.

**16.4 Venue.** Otherwise, any lawsuit arising from this Agreement will be brought only in the state or federal courts located in St. Louis County or the City of St. Louis, Missouri. Each party consents to those courts' jurisdiction and waives any objection that they are an inconvenient forum.

**16.5 Fallback.** If a court with jurisdiction holds Section 16.4 unenforceable as to a dispute, including under N.C. Gen. Stat. § 22B-3:

1. the rest of this Agreement remains in effect;
2. Missouri law continues to govern to the fullest extent permitted; and
3. the dispute may proceed in a court of competent jurisdiction in the county and state of the defending party's principal place of business.

The parties may still agree, after a dispute arises, to resolve it in St. Louis County or the City of St. Louis.

**16.6 Where this Agreement is made.** You sign and deliver this Agreement first. It becomes binding only when Geega Games accepts it by countersigning in Missouri, and the Effective Date is the date of that countersignature. The parties intend this Agreement to be entered into in Missouri.

**16.7 Attorneys' fees.** In any lawsuit or arbitration to enforce or interpret this Agreement, the prevailing party may recover its reasonable attorneys' fees and costs from the other party. This applies equally to both parties. In a claim mainly for money, fees awarded may not exceed the amount in controversy.

**16.8 No other limits.** Nothing in this Agreement shortens any period allowed by law to bring a claim.

## 17. Electronic signatures and records

**17.1 Electronic dealings.** The parties agree to conduct this transaction electronically. Electronic signatures have the same effect as handwritten ones, under the federal Electronic Signatures in Global and National Commerce Act and the Missouri Uniform Electronic Transactions Act. Notices, statements and records may be delivered by email or through Geega Games' website.

**17.2 What is recorded.** For each signature, Geega Games keeps:

- the version and full text shown
- the signer's typed legal name, title and signature, and the legal entity represented
- each confirmation box
- the time
- the email address the signing link was sent to
- the IP address and browser

Geega Games makes two separate SHA-256 fingerprints:

- **Agreement text fingerprint:** of the exact text shown, so any change to the text can be detected.
- **Signed PDF fingerprint:** of the completed PDF file, so any copy can be checked against the original.

**17.3 Delivery and retention.** Both parties receive the signed PDF by email. Geega Games keeps the signed record for the Term plus 7 years. Either party may request a paper copy at no charge by emailing ${plain(ctx.supportEmail)}.

**17.4 Withdrawing consent.** You may withdraw consent to electronic records by written notice. This does not affect records already delivered. Either party may then end this Agreement under Section 14.2.

**17.5 Counterparts.** This Agreement may be signed in counterparts, each an original, together one agreement.

## 18. General terms

**18.1 Notices** go to the email addresses in the Key Terms table (and, for you, also the business address in the signing record), or to updated details given in writing. Email notices are effective when sent, unless a delivery failure is received.

**18.2 Assignment.** You may not assign or transfer this Agreement, or any fee under it, without Geega Games' written consent. Geega Games may assign it to a successor to its business. It binds permitted successors.

**18.3 Severability.** If any part is held unenforceable, it will be enforced as far as allowed, and the rest remains in effect.

**18.4 Waiver.** Not enforcing a term is not a waiver of it.

**18.5 Entire agreement.** This Agreement, with Schedule A, is the parties' entire agreement about the program. It replaces all earlier versions, discussions and promises about it.

**18.6 No third-party beneficiaries.** Sellers, partner stores and others have no rights under this Agreement.

**18.7 Interpretation.** "Including" means "including without limitation." Headings are for convenience only.

**18.8 Force majeure.** Neither party is liable for delay caused by events beyond its reasonable control, except for payment obligations.

## Signatures

The Referral Partner signs first, electronically, giving its legal entity name, type, state and business address and the signer's name and title. Geega Games LLC then countersigns electronically. Both signatures, with each signer's name, title and the date, are shown in the signing record that forms part of this Agreement (Section 17.2).

## Schedule A: sample fee disclosures

Use wording at least this clear, placed next to your link or recommendation:

- **Website or flyer:** "I'm a paid referral partner of Geega Games. If they buy a collection you send through my link, they pay me a fee. It doesn't change your offer."
- **Social post:** "Paid partner: I earn a fee from Geega Games if they buy your collection through my link."
- **Link label or QR caption:** "Referral link: I may earn a fee."
- **In person or by email:** "Just so you know, Geega Games pays me a referral fee if they buy from you. It costs you nothing."`;
}

function storeTemplate(ctx: PartnerAgreementContext): string {
  const fee = formatFeePercent(ctx.feePercent);
  const standards = PARTNER_STORE_STANDARDS.map((s) => `- ${s}`).join("\n");
  return `# ${PARTNER_AGREEMENT_TITLE.store}

Version ${PARTNER_AGREEMENT_VERSION.store}

${partiesTable(ctx, "Partner Store")}

## 1. What this Agreement is for

Geega Games receives requests from people selling trading cards, video games and collections that it may not buy itself. Under this Agreement, Geega Games may pass some of those requests to you, and you pay Geega Games a finder's fee when you buy from a seller we sent you. **The finder's fee is owed on every purchase from that seller for ${STORE_FEE_TAIL_MONTHS} months after the lead.**

## 2. Definitions

**2.1 Lead** means a seller's request, contact details, descriptions or photos that Geega Games sends you, by email, our system or any other way. The date of a Lead is the date we send it.

**2.2 Referred Seller** means the seller in a Lead, together with anyone acting for them or in the same household or business, for the items in the Lead and any other items they sell you.

**2.3 Purchase** means any acquisition by you of items from a Referred Seller, in any form: cash, check, electronic payment, store credit, trade, or a consignment or partnership arrangement. It includes purchases by your owners, employees, affiliates, or anyone buying on your behalf.

**2.4 Purchase Price** means the total value you give a Referred Seller in a Purchase, before any fees or deductions: cash and electronic payments at face value, store credit and trade credit at their face value, and traded goods at their retail value. For a consignment, it is the amount paid to the Referred Seller.

## 3. Leads

**3.1 Our choice.** Geega Games decides, in its sole discretion, whether to send you any Lead. We don't promise any number or kind of Leads, and we may send a seller's request to another store instead.

**3.2 Only with the seller's permission.** We only send a Lead when the seller asked for an offer from a partner store. You'll respond only to that request, as the seller asked to be contacted.

## 4. The finder's fee

**4.1 How much.** For each Purchase from a Referred Seller made within ${STORE_FEE_TAIL_MONTHS} months after the date of the Lead, you'll pay Geega Games a finder's fee of **${fee} of the Purchase Price**. The fee applies even if the Purchase includes items that weren't described in the Lead, and even if the seller later contacts you directly.

**4.2 Seller already yours.** If you can show us, within 3 business days of receiving a Lead, written records that you were already actively negotiating with that seller for the same items before the Lead, tell us and no fee will be owed for that Lead.

**4.3 Your purchase, your responsibility.** Geega Games is not a party to any Purchase and does not buy, sell, inspect or guarantee any items. You're solely responsible for your offers, payments to sellers, checking authenticity and ownership, and following any laws that apply to buying secondhand goods (including any identification, record-keeping or holding requirements).

**4.4 Reporting.** You'll tell us about every Purchase from a Referred Seller within 3 business days after it happens, with the date and the Purchase Price, and tell us how each Lead turned out (sold or not). We may also check with sellers directly.

**4.5 Statements and payment.** We'll send you statements of finder's fees owed. You'll pay each statement within 15 days, by the method shown on it. Amounts not paid when due accrue interest at 1.5% per month (or the highest rate the law allows, if lower) from the due date, and you'll pay our reasonable costs of collecting overdue amounts, including attorneys' fees.

**4.6 Records and review.** You'll keep accurate records of every Purchase from a Referred Seller for at least 2 years, and give us copies within 10 business days of our request. If a review shows you under-reported Purchases, you'll pay the unpaid fees with interest within 15 days, and if the shortfall is more than 5%, you'll also pay the reasonable cost of the review.

**4.7 Pausing Leads.** We may stop sending Leads at any time, including while any statement is overdue.

## 5. No going around Geega Games

You won't avoid or reduce the finder's fee, directly or indirectly, including by: delaying a Purchase until after the ${STORE_FEE_TAIL_MONTHS}-month period; splitting a Purchase or recording it at less than the Purchase Price; buying through an owner, employee, affiliate, friend or another business; asking or encouraging a Referred Seller to contact you "directly" or to submit a new request somewhere else; or under-reporting a Purchase. Any Purchase made that way is treated as a Purchase within the ${STORE_FEE_TAIL_MONTHS}-month period at its full value.

## 6. Sellers' information

**6.1 Use.** You'll use a Referred Seller's information only to respond to that seller's request and complete a Purchase with them. You won't add it to a mailing list, use it for marketing, or sell, rent or share it with anyone.

**6.2 Care and deletion.** You'll keep sellers' information secure, follow all privacy laws that apply, and delete it when you no longer need it for the Purchase or your legally required records, or when we or the seller ask (except records you must keep by law).

## 7. Standards for partner stores

You'll meet these standards with every Lead:

${standards}

You'll also deal honestly and fairly with sellers, follow all laws that apply, never use automated texts or calls, never pressure a seller, and not say or suggest that Geega Games has valued, inspected or guaranteed anything. If you don't meet these standards, we may stop sending Leads or end this Agreement.

${commonTerms(ctx, { first: 8 })}`;
}

/** The agreement for this partner, filled in. */
export function renderPartnerAgreement(ctx: PartnerAgreementContext): string {
  if (!Number.isFinite(ctx.feePercent) || ctx.feePercent < 0 || ctx.feePercent > 50) {
    throw new Error("Set this partner's fee (0–50%) before sending an agreement.");
  }
  return ctx.kind === "store" ? storeTemplate(ctx) : referrerTemplate(ctx);
}

// ---------------------------------------------------------------- signing checks

export interface PartnerSigningInput {
  legalName: string;
  title: string;
  typedSignature: string;
  acknowledgments: Record<string, boolean | undefined>;
  /** Required when the agreement asks for the partner's legal entity (countersigned agreements). */
  entity?: PartnerEntityInput;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** What's still needed before signing; empty when ready. */
export function partnerSigningProblems(kind: PartnerKind, input: PartnerSigningInput, opts: { collectEntity?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (opts.collectEntity) {
    const e = input.entity ?? { name: "", type: "", state: "", address: "" };
    if (e.name.trim().length < 2) problems.push("Enter the legal name of the business (or your own name, if you're an individual).");
    if (!isPartnerEntityType(e.type)) problems.push("Choose what kind of business it is.");
    if (!/^[A-Z]{2}$/.test(e.state.trim().toUpperCase())) {
      problems.push(e.type === "individual" ? "Choose the state you live in." : "Choose the state the business is organized in.");
    }
    if (e.address.trim().length < 8) problems.push("Enter the business's mailing address.");
  }
  const name = input.legalName.trim();
  if (name.length < 3) problems.push("Enter your full legal name.");
  if (input.title.trim().length < 2) problems.push("Enter your title or role (for example, Owner).");
  const sig = input.typedSignature.trim();
  if (sig.length < 3) problems.push("Type your full name as your signature.");
  else if (name && norm(sig) !== norm(name)) problems.push("Your signature must match your full legal name exactly.");
  const missing = PARTNER_AGREEMENT_ACKS[kind].filter((a) => input.acknowledgments[a.key] !== true);
  if (missing.length) problems.push(`Tick all ${PARTNER_AGREEMENT_ACKS[kind].length} boxes to sign.`);
  return problems;
}

/** What's still needed before Geega Games countersigns; empty when ready. */
export function countersignProblems(input: { name: string; title: string; typedSignature: string; authorized: boolean }): string[] {
  const problems: string[] = [];
  if (input.name.trim().length < 3) problems.push("Enter your full legal name.");
  if (input.title.trim().length < 2) problems.push("Enter your title (for example, Owner).");
  const sig = input.typedSignature.trim();
  if (sig.length < 3) problems.push("Type your full name as your signature.");
  else if (input.name.trim() && norm(sig) !== norm(input.name)) problems.push("Your signature must match your full legal name exactly.");
  if (!input.authorized) problems.push("Confirm you're authorized to sign for Geega Games LLC.");
  return problems;
}

// ---------------------------------------------------------------- when a referral fee is earned

export interface ReferralWindowInput {
  /** The agreement version the referral falls under (15.2: the one in force when it was recorded). */
  agreementVersion: number;
  requestedAt: string;
  closedAt: string;
  /** When the seller accepted Geega Games' offer, if they did. */
  offerAcceptedAt: string | null;
}

export interface ReferralWindowResult {
  ok: boolean;
  /** Days allowed from request to close for this referral. */
  allowedDays: number;
  /** The 30-day Completion Extension applied (version 2+). */
  extended: boolean;
  /** Where the rule is, for messages: "section 4.1" (v1) or "sections 2.12 and 5.1" (v2). */
  section: string;
}

const DAY_MS = 86_400_000;

/**
 * Did the purchase close in time? Version 1: within REFERRAL_WINDOW_DAYS of
 * the request. Version 2 adds the Completion Extension: if the seller accepted
 * the offer within REFERRAL_WINDOW_DAYS, closing may take
 * REFERRAL_COMPLETION_EXTENSION_DAYS more (section 2.12).
 */
export function referralWindow(input: ReferralWindowInput): ReferralWindowResult {
  const requested = new Date(input.requestedAt).getTime();
  const closed = new Date(input.closedAt).getTime();
  const base = REFERRAL_WINDOW_DAYS * DAY_MS;
  if (input.agreementVersion < 2) {
    return { ok: closed - requested <= base, allowedDays: REFERRAL_WINDOW_DAYS, extended: false, section: "section 4.1" };
  }
  const accepted = input.offerAcceptedAt ? new Date(input.offerAcceptedAt).getTime() : NaN;
  const extended = Number.isFinite(accepted) && accepted - requested <= base;
  const allowedDays = REFERRAL_WINDOW_DAYS + (extended ? REFERRAL_COMPLETION_EXTENSION_DAYS : 0);
  return { ok: closed - requested <= allowedDays * DAY_MS, allowedDays, extended, section: "sections 2.12 and 5.1" };
}

/** When an executed agreement took effect: the countersignature if it needed one, else the partner's signature. */
export function agreementEffectiveAt(a: { signed_at: string | null; countersigned_at?: string | null }): string | null {
  return a.countersigned_at ?? a.signed_at;
}
