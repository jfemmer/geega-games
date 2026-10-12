// The partner program, shared by the storefront (the /for-stores and
// /referral-partners application forms), the admin (Partners page, sending a
// lead to a store) and the API. Pure module — no browser or Node APIs.
//
//   * Partner stores buy collections. We send them sellers who asked for an
//     offer; they pay a finder's fee (a percent of what they pay the seller)
//     only when they buy.
//   * Referral partners — estate sale companies, estate attorneys, realtors,
//     move managers — send sellers to us. They earn a referral fee (a percent
//     of the sale) when someone they sent sells.
//   * Customers get a personal referral link and earn store credit when a
//     seller they referred sells.
//
// The values mirror the check constraints in the partner_program migration.

import { REFERRAL_CATEGORIES, type ReferralCategory } from "./referralTypes.js";

export const PARTNER_KINDS = [
  { value: "store", label: "Partner store" },
  { value: "referrer", label: "Referral partner" },
] as const;

export type PartnerKind = (typeof PARTNER_KINDS)[number]["value"];

export function isPartnerKind(value: unknown): value is PartnerKind {
  return PARTNER_KINDS.some((k) => k.value === value);
}

export const PARTNER_STATUSES = [
  { value: "applied", label: "New application" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "declined", label: "Declined" },
] as const;

export type PartnerStatus = (typeof PARTNER_STATUSES)[number]["value"];

export function isPartnerStatus(value: unknown): value is PartnerStatus {
  return PARTNER_STATUSES.some((s) => s.value === value);
}

/** What a partner store buys: Magic (for collections Geega Games passes on), the referral categories, and other card games. */
export const PARTNER_CATEGORIES = [
  { value: "magic", label: "Magic: The Gathering" },
  ...REFERRAL_CATEGORIES,
  { value: "other_tcg", label: "Other card games" },
] as const;

export type PartnerCategory = "magic" | ReferralCategory | "other_tcg";

export function isPartnerCategory(value: unknown): value is PartnerCategory {
  return PARTNER_CATEGORIES.some((c) => c.value === value);
}

export function partnerCategoryLabel(value: string): string {
  return PARTNER_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export const PARTNER_PROFESSIONS = [
  { value: "estate_sale", label: "Estate sale company" },
  { value: "estate_attorney", label: "Estate or probate attorney" },
  { value: "realtor", label: "Real estate agent" },
  { value: "move_manager", label: "Senior move manager / downsizing" },
  { value: "auction", label: "Auction house" },
  { value: "other", label: "Something else" },
] as const;

export type PartnerProfession = (typeof PARTNER_PROFESSIONS)[number]["value"];

export function isPartnerProfession(value: unknown): value is PartnerProfession {
  return PARTNER_PROFESSIONS.some((p) => p.value === value);
}

/** What came of a lead sent to a store. "Waiting" until the store or seller tells us. */
export const PARTNER_REFERRAL_OUTCOMES = [
  { value: "pending", label: "Waiting to hear" },
  { value: "sold", label: "Sold to the store" },
  { value: "not_sold", label: "Didn't sell" },
  { value: "no_response", label: "Couldn't reach the seller" },
  { value: "passed", label: "Store passed on it" },
] as const;

export type PartnerReferralOutcome = (typeof PARTNER_REFERRAL_OUTCOMES)[number]["value"];

export function isPartnerReferralOutcome(value: unknown): value is PartnerReferralOutcome {
  return PARTNER_REFERRAL_OUTCOMES.some((o) => o.value === value);
}

/** Outcomes that free the lead to go to another store. */
export const REOPENING_OUTCOMES: readonly PartnerReferralOutcome[] = ["no_response", "passed"];

export const FEE_STATUSES = [
  { value: "none", label: "No fee" },
  { value: "owed", label: "Owed" },
  { value: "paid", label: "Paid" },
  { value: "waived", label: "Waived" },
] as const;

export type FeeStatus = (typeof FEE_STATUSES)[number]["value"];

export function isFeeStatus(value: unknown): value is FeeStatus {
  return FEE_STATUSES.some((s) => s.value === value);
}

/** The seller's answer to the check-in email a week after we pass their details on. */
export const CHECKIN_ANSWERS = [
  { value: "sold", label: "Yes — I sold to them" },
  { value: "not_sold", label: "They contacted me, but I didn't sell" },
  { value: "not_contacted", label: "They haven't contacted me" },
] as const;

export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number]["value"];

export function isCheckinAnswer(value: unknown): value is CheckinAnswer {
  return CHECKIN_ANSWERS.some((a) => a.value === value);
}

/**
 * What every partner store agrees to. One copy, shown on /for-stores, in the
 * application checkbox, the approval email and every lead email.
 */
export const PARTNER_STORE_STANDARDS = [
  "Contact the seller within one business day, personally, the way they asked to be contacted. No automated texts or calls.",
  "Make a fair, no-pressure offer, and take no for an answer.",
  "Use the seller's details only for this offer: no mailing lists, and never pass them on.",
  "Tell us how it went: sold (and for how much) or not.",
] as const;

/**
 * The optional checkbox on the Magic sell forms (the full /sell flow and the
 * quick photo quote). Unticked by default; the API stores it as
 * sell_submissions.partner_consent_at, and only then can staff send the
 * submission to a partner store.
 */
export const MAGIC_PARTNER_CONSENT_LABEL =
  "Optional: if Geega Games passes on my collection, share my submission — contact details, card list and photos — with one partner store that buys Magic cards, so they can contact me about an offer. If I sell to that store, it may pay Geega Games a referral fee.";

/** Days after sending a lead before the seller gets the "did they contact you?" email. */
export const CHECKIN_AFTER_DAYS = 7;

/** Starting fee for a new partner store: a percent of what the store pays the seller. */
export const DEFAULT_STORE_FEE_PERCENT = 8;
/**
 * Starting fee for a new referral partner: a percent of the sale. Lower than
 * a store's, since a referred seller may sell to a partner store whose
 * finder's fee is what pays it.
 */
export const DEFAULT_REFERRER_FEE_PERCENT = 3;

export function defaultFeePercent(kind: PartnerKind): number {
  return kind === "store" ? DEFAULT_STORE_FEE_PERCENT : DEFAULT_REFERRER_FEE_PERCENT;
}

/** Store credit for a customer whose referred seller sells (to us or a partner store). */
export const SELLER_REFERRAL_REWARD_CENTS = 1000;

/**
 * Where referral links and the "we buy" flyers point: the page that lists
 * everything sellers can get an offer on (SellHubPage).
 */
export const SELL_HUB_PATH = "/sell-cards-and-games";
/** The public pages that recruit partners. */
export const FOR_STORES_PATH = "/for-stores";
export const REFERRAL_PARTNERS_PATH = "/referral-partners";

/** A fee in cents: `percent` of `amountCents`, rounded half up. */
export function feeCents(amountCents: number, percent: number): number {
  if (!Number.isFinite(amountCents) || !Number.isFinite(percent) || amountCents <= 0 || percent <= 0) return 0;
  return Math.round((Math.round(amountCents) * percent) / 100);
}

/** "8%" / "7.5%" */
export function formatPercent(percent: number): string {
  return `${Number.isInteger(percent) ? percent : Number(percent.toFixed(2))}%`;
}

/**
 * The partner categories a lead falls under: a referral lead's own
 * categories, or Magic for a sell submission Geega Games passed on.
 */
export function leadPartnerCategories(
  lead: { kind: "referral_lead"; categories: readonly string[] } | { kind: "sell_submission" },
): PartnerCategory[] {
  if (lead.kind === "sell_submission") return ["magic"];
  return lead.categories.filter(isPartnerCategory);
}

/** True when the partner buys at least one of the lead's categories. */
export function partnerBuysAny(partnerCategories: readonly string[], leadCategories: readonly string[]): boolean {
  return leadCategories.some((c) => partnerCategories.includes(c));
}
