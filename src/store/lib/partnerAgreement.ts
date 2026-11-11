// The partner program's two agreements, signed electronically when the owner
// approves a partner:
//
//   referrer  Referral Partner Agreement: a referral fee only when Geega Games
//             itself buys a referred collection and the purchase closes. No
//             fee when a lead is passed to a partner store or sold elsewhere.
//   store     Partner Store Agreement: the finder's fee a partner store owes
//             Geega Games on every purchase from a seller it was sent,
//             including later purchases (no going around Geega Games).
//
// The text lives here, versioned. Sending an agreement renders the template
// with the partner's details and fee, and the server freezes that text with
// its SHA-256 (partner_agreements). A material change is a new version, which
// partners sign again. The signing page and the signed PDF both draw from
// parseAgreement(), so the PDF shows exactly what was signed.
//
// Pure module: no React, browser, Node or Supabase imports.

import { PARTNER_STORE_STANDARDS, type PartnerKind } from "./partnerTypes.js";

// Same markdown subset and parser as the consignment agreement.
export { parseAgreement, type AgreementBlock, type Inline } from "./consignmentAgreement.js";

export const PARTNER_AGREEMENT_VERSION: Record<PartnerKind, number> = { referrer: 1, store: 1 };

export const PARTNER_AGREEMENT_TITLE: Record<PartnerKind, string> = {
  referrer: "Geega Games Referral Partner Agreement",
  store: "Geega Games Partner Store Agreement",
};

/** Days a signing link stays open. */
export const PARTNER_AGREEMENT_INVITE_DAYS = 14;

/** Months after a lead during which a partner store owes the finder's fee on any purchase from that seller. */
export const STORE_FEE_TAIL_MONTHS = 12;

/** Days after a referral (the seller's request) during which a closed purchase still earns the referral fee. */
export const REFERRAL_WINDOW_DAYS = 180;

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
    ESIGN_ACK,
    REVIEWED_ACK,
    {
      key: "direct_purchase",
      label:
        "I understand a referral fee is earned only when Geega Games itself buys a collection I referred and the purchase closes (Section 4).",
    },
    {
      key: "no_store_fee",
      label:
        "I understand no referral fee is owed for a collection passed to a partner store, sold to anyone else, or not bought (Section 4.3).",
    },
    {
      key: "conduct",
      label: "I'll only share my link with people who want an offer, and I'll tell them I may earn a referral fee (Section 6).",
    },
    { key: "taxes", label: "I'm responsible for my own taxes and will provide a W-9 before I'm paid (Section 5)." },
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

export interface PartnerAgreementContext {
  kind: PartnerKind;
  businessName: string;
  contactName: string;
  email: string;
  /** City, ST — or null. */
  location: string | null;
  feePercent: number;
  /** ISO date the agreement was sent (shown as the "sent" date; the effective date is the signing date). */
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

function partiesTable(ctx: PartnerAgreementContext, partnerLabel: string): string {
  return [
    "| Term | Details |",
    "| --- | --- |",
    `| Geega Games | Geega Games LLC, a Missouri limited liability company, St. Louis, Missouri ("**Geega Games**", "we", "us") |`,
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

function referrerTemplate(ctx: PartnerAgreementContext): string {
  const fee = formatFeePercent(ctx.feePercent);
  return `# ${PARTNER_AGREEMENT_TITLE.referrer}

Version ${PARTNER_AGREEMENT_VERSION.referrer}

${partiesTable(ctx, "Referral Partner")}

## 1. What this Agreement is for

You'd like to refer people who want to sell trading cards, games or collections to Geega Games, and earn a referral fee when we buy what they're selling. This Agreement sets out when a fee is earned, how much it is, and how it's paid. **A referral fee is earned only when Geega Games itself buys a referred collection and that purchase closes.**

## 2. Definitions

**2.1 Seller** means a person or business that owns items they want to sell and asks Geega Games for an offer.

**2.2 Your Link** means the personal referral link, code or QR code we give you.

**2.3 Qualified Referral** means a Seller who submits their own request for an offer to Geega Games through Your Link (or whose request carries your referral code in our records), where: (a) that Seller had not already contacted Geega Games about the same items, and was not already an open lead or a customer we bought from, in the 12 months before; (b) the Seller is not you, your business, your employees, or anyone buying or selling on your behalf; and (c) the request was submitted while this Agreement was in effect and you were active in the program.

**2.4 Direct Purchase** means Geega Games LLC itself buys items from the Seller, in its own name and for its own account.

**2.5 Closed** means all of these have happened: Geega Games has received the items; we have inspected and accepted them; the Seller has been paid in full; and the purchase has not been cancelled, refunded, reversed or disputed (including a payment dispute, chargeback, or a claim that the items were stolen, counterfeit or not the Seller's to sell).

**2.6 Net Purchase Price** means the amount Geega Games paid the Seller for the items it bought and kept in a Closed Direct Purchase, not counting shipping, insurance, taxes, fees, or any amount later refunded or recovered. If the Seller chose store credit, trade credit or any non-cash payment, the Net Purchase Price is the cash amount we offered for the same items, as shown in our records.

## 3. How referrals work

**3.1 Sellers send their own request.** You share Your Link with people who want an offer. The Seller fills in their own request, with the information and contact preferences they choose. Don't submit a request for a Seller or send us their personal information without their permission.

**3.2 Our records decide attribution.** Whether a request is a Qualified Referral, and to whom it is credited, is decided from Geega Games' records (including the referral code captured with the request). If two people claim the same Seller, the fee goes only to the one whose link the Seller's first request came through. Our good-faith determination is final unless there's an obvious error.

**3.3 No obligation to buy.** Geega Games decides, in its sole discretion, whether to make an offer, what to offer, and whether to buy. We don't have to contact, make an offer to, or buy from any Seller, and a Seller doesn't have to accept any offer.

## 4. The referral fee

**4.1 When it's earned.** You earn a referral fee only when **all** of these are true: (a) the Seller is a Qualified Referral; (b) Geega Games makes a Direct Purchase from that Seller; (c) the purchase is Closed; and (d) the Seller's request was made within ${REFERRAL_WINDOW_DAYS} days before the purchase closed. A fee is not earned when a Seller merely asks for an offer, receives one, or agrees to sell.

**4.2 How much.** The referral fee is **${fee} of the Net Purchase Price** of each Closed Direct Purchase from a Qualified Referral. If we buy only part of a collection, the fee is based only on the part we bought and kept. One fee is earned per purchase, and only one partner is paid for any purchase.

**4.3 When no fee is owed.** No referral fee is owed, by Geega Games or anyone else, when:

1. the Seller doesn't sell, declines our offer, or we don't make one;
2. Geega Games passes the Seller's request to a partner store or any other buyer, or the Seller sells to a partner store, another buyer, or anyone other than Geega Games, even if we introduced them;
3. the items are consigned with Geega Games, traded, or handled any way other than a Closed Direct Purchase, unless we agree otherwise in writing for that Seller;
4. the purchase is later cancelled, refunded, reversed or disputed, or the items turn out to be stolen, counterfeit, or not the Seller's to sell; or
5. you broke this Agreement in connection with that Seller.

You agree you have no claim against Geega Games, any partner store, or any Seller for a fee in these cases.

**4.4 Payment.** We'll email you when a referral fee is earned. Earned fees are paid within 30 days after the end of the month in which the purchase Closed, by a method we choose (such as check, PayPal or bank transfer). We may hold payment until you've given us a completed IRS Form W-9 and your payment details, and until your earned fees total at least $25 (any balance is paid when this Agreement ends).

**4.5 Corrections and refunds.** If a fee was paid by mistake, or a purchase is later cancelled, refunded, reversed or disputed, you'll repay that fee within 30 days of our request, and we may also deduct it from any fees owed to you.

**4.6 Questions about a fee.** If you think a fee is missing or wrong, tell us in writing within 60 days after we email you about the purchase (or, for a referral you think closed, within 60 days after it would have been paid). After that, our records and payments are final.

## 5. Taxes

You're an independent business, responsible for all taxes on fees you receive. Geega Games doesn't withhold taxes and may report payments to the IRS (for example, on Form 1099).

## 6. How you'll represent Geega Games

**6.1 Honest and lawful.** You will follow all laws that apply to you, including laws about advertising, privacy, email, texting and calling. You won't spam, cold-text or auto-dial anyone, or buy or use lists of contacts, to promote Your Link.

**6.2 No promises for us.** You won't promise or estimate any offer, price, payment or timing on Geega Games' behalf, describe yourself as our employee or agent, or say we endorse anything beyond this program.

**6.3 Tell people about your fee.** You'll tell each person you refer that you may receive a referral fee from Geega Games if we buy from them. If your profession has its own rules about referral fees or disclosures (for example, for attorneys, real estate agents or fiduciaries), you're responsible for following them and confirm you're allowed to accept these fees.

**6.4 No handling of property.** You won't take possession of, hold, ship, pay for, or collect payment for any Seller's items on Geega Games' behalf.

**6.5 Search and social.** You won't bid on "Geega Games" or similar terms in paid search ads, or make websites, profiles or ads that could be mistaken for Geega Games.

**6.6 Confidential information.** Information about Sellers, offers and prices you learn through the program is confidential. Use it only to take part in this program.

${commonTerms(ctx, { first: 7 })}`;
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

/** What's still needed before signing; empty when ready. */
export function partnerSigningProblems(
  kind: PartnerKind,
  input: { legalName: string; title: string; typedSignature: string; acknowledgments: Record<string, boolean | undefined> },
): string[] {
  const problems: string[] = [];
  const name = input.legalName.trim();
  if (name.length < 3) problems.push("Enter your full legal name.");
  if (input.title.trim().length < 2) problems.push("Enter your title or role (for example, Owner).");
  const sig = input.typedSignature.trim();
  if (sig.length < 3) problems.push("Type your full name as your signature.");
  else if (name && sig.replace(/\s+/g, " ").toLowerCase() !== name.replace(/\s+/g, " ").toLowerCase()) {
    problems.push("Your signature must match your full legal name exactly.");
  }
  const missing = PARTNER_AGREEMENT_ACKS[kind].filter((a) => input.acknowledgments[a.key] !== true);
  if (missing.length) problems.push(`Tick all ${PARTNER_AGREEMENT_ACKS[kind].length} boxes to sign.`);
  return problems;
}
