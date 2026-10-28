// Consignment payout math, shared by the estimator (storefront + admin) and
// the server-side settlement of real sales.
//
//   Final Selling Price
//   − Transaction Expenses (marketplace fee, processing, net postage,
//     approved insurance, other approved expenses)
//   = Net Sale Amount                      (never below 0)
//   − Commission  (tier picked by the card's Final Selling Price,
//                  rate applied to the Net Sale Amount)
//   = Consignor Proceeds
//
// Consignment Agreement sections 4 and 5. Every amount is whole cents.
// Percentages are basis points (1000 = 10%). Rounding is to the nearest cent,
// halves up, applied once per line.
//
// Pure module: no React, browser, Node or Supabase imports.
//
// IMPORTANT: The database (consignment_commission_cents() and
// consignment_insurance_premium_cents()) is the authority for final payouts.
// The functions below MUST agree with it; tests/consignmentMath.test.ts holds
// the shared cases.

export type ConsignmentChannel = "website" | "tcgplayer" | "ebay";

export const CONSIGNMENT_CHANNELS: readonly ConsignmentChannel[] = ["website", "tcgplayer", "ebay"];

export const CHANNEL_LABELS: Record<ConsignmentChannel, string> = {
  website: "Geega Games website",
  tcgplayer: "TCGplayer",
  ebay: "eBay",
};

/** The text shown above every estimate, verbatim. Never hide it behind a tooltip. */
export const ESTIMATE_DISCLAIMER =
  "All amounts shown are estimates only. Your actual payout may differ based on the final selling price, sales platform fees, payment processing costs, shipping charges, insurance costs, and other authorized transaction expenses. Final payouts are calculated using actual expenses after the sale.";

/** The line shown under an estimated payout figure. */
export const ESTIMATE_FOOTNOTE = "Estimate only — final payout will be based on actual transaction expenses.";

export const COMBINED_SHIPMENT_NOTE =
  "This estimate assumes the card ships alone. When cards are combined into one package, postage and insurance are shared between them, so each card's share may change.";

// ---------------------------------------------------------------- rounding

/** amount × bps / 10000, rounded to the nearest cent with halves up. */
export function applyBps(amountCents: number, bps: number): number {
  if (!Number.isFinite(amountCents) || !Number.isFinite(bps)) return 0;
  const a = Math.round(amountCents);
  const b = Math.round(bps);
  const product = a * b;
  // Halves away from zero is the same as halves up for the non-negative
  // amounts used here; floor division keeps it exact in integers.
  return product >= 0 ? Math.floor((product + 5000) / 10000) : -Math.floor((-product + 5000) / 10000);
}

/** Parse "12.34" / "$1,234.5" into cents, or null when it isn't a money amount. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

// ---------------------------------------------------------------- commission

export interface CommissionTier {
  /** Highest Final Selling Price (cents) this tier covers, inclusive. null = no upper limit. */
  maxPriceCents: number | null;
  /** Commission rate on the Net Sale Amount, in basis points. */
  rateBps: number;
}

/** The tiers in the agreement: $150.00 or less → 20%; $150.01 or more → 10%. */
export const DEFAULT_COMMISSION_TIERS: readonly CommissionTier[] = [
  { maxPriceCents: 15000, rateBps: 2000 },
  { maxPriceCents: null, rateBps: 1000 },
];

/** The tier that applies to one card, chosen by its Final Selling Price before deductions. */
export function commissionRateBps(finalPriceCents: number, tiers: readonly CommissionTier[]): number {
  const sorted = [...tiers].sort((a, b) => (a.maxPriceCents ?? Infinity) - (b.maxPriceCents ?? Infinity));
  for (const t of sorted) {
    if (t.maxPriceCents == null || finalPriceCents <= t.maxPriceCents) return t.rateBps;
  }
  // Tiers without an open-ended top: the last tier covers the rest.
  return sorted.length ? sorted[sorted.length - 1].rateBps : 0;
}

// ---------------------------------------------------------------- fees

/** What a fee percentage is charged on. eBay charges on shipping and sales tax too. */
export type FeeBase = "item" | "item_shipping" | "item_shipping_tax";

export interface ChannelFeeSchedule {
  channel: ConsignmentChannel;
  /** Marketplace commission on the fee base, in bps (0 for the website). */
  marketplaceBps: number;
  /** Optional second marketplace rate above a per-item threshold (eBay). */
  marketplaceThresholdCents: number | null;
  marketplaceAboveThresholdBps: number | null;
  marketplaceBase: FeeBase;
  /** Per-order fixed fee charged by the marketplace. */
  perOrderCents: number;
  /** Optional lower per-order fee for small orders (eBay charges less at or below a total). */
  perOrderSmallCents: number | null;
  perOrderSmallMaxCents: number | null;
  /** Payment processing in bps, 0 when the marketplace fee already includes it (eBay). */
  processingBps: number;
  processingFixedCents: number;
  processingBase: FeeBase;
}

/** The base a fee is charged on, for one card in one order. */
function feeBaseCents(base: FeeBase, itemCents: number, shippingCents: number, taxCents: number): number {
  switch (base) {
    case "item":
      return itemCents;
    case "item_shipping":
      return itemCents + shippingCents;
    case "item_shipping_tax":
      return itemCents + shippingCents + taxCents;
  }
}

export interface ChannelFeeEstimate {
  marketplaceFeeCents: number;
  processingFeeCents: number;
}

/**
 * A channel's fees on a single-card order. Buyer-paid shipping and sales tax
 * are passed in because some channels (eBay) charge fees on them, even though
 * they are never the consignor's revenue.
 */
export function channelFees(
  s: ChannelFeeSchedule,
  input: { itemCents: number; buyerShippingCents: number; salesTaxCents: number },
): ChannelFeeEstimate {
  const { itemCents, buyerShippingCents, salesTaxCents } = input;
  const mBase = feeBaseCents(s.marketplaceBase, itemCents, buyerShippingCents, salesTaxCents);
  let marketplace: number;
  if (s.marketplaceThresholdCents != null && s.marketplaceAboveThresholdBps != null && mBase > s.marketplaceThresholdCents) {
    marketplace =
      applyBps(s.marketplaceThresholdCents, s.marketplaceBps) +
      applyBps(mBase - s.marketplaceThresholdCents, s.marketplaceAboveThresholdBps);
  } else {
    marketplace = applyBps(mBase, s.marketplaceBps);
  }
  const orderTotal = itemCents + buyerShippingCents + salesTaxCents;
  const perOrder =
    s.perOrderSmallCents != null && s.perOrderSmallMaxCents != null && orderTotal <= s.perOrderSmallMaxCents
      ? s.perOrderSmallCents
      : s.perOrderCents;
  const pBase = feeBaseCents(s.processingBase, itemCents, buyerShippingCents, salesTaxCents);
  const processing = s.processingBps > 0 || s.processingFixedCents > 0 ? applyBps(pBase, s.processingBps) + s.processingFixedCents : 0;
  return { marketplaceFeeCents: marketplace + perOrder, processingFeeCents: processing };
}

// ---------------------------------------------------------------- insurance

export interface InsuranceBracket {
  /** Highest package value (cents) in this bracket, inclusive. */
  maxValueCents: number;
  premiumCents: number;
}

export interface InsuranceSchedule {
  /** Coverage included with the service at no charge (Ground Advantage: $100). */
  includedCoverageCents: number;
  /** Ascending brackets. The first normally ends at the included coverage with a $0 premium. */
  brackets: readonly InsuranceBracket[];
  /** Above the last bracket: + stepPremiumCents for each stepCents (or fraction). */
  stepCents: number;
  stepPremiumCents: number;
  /** Largest value the carrier will insure. Above it, a package needs manual review. */
  maxInsurableCents: number;
}

export interface InsuranceQuote {
  premiumCents: number;
  /** True when included coverage already covers the package, so nothing extra is bought. */
  includedOnly: boolean;
  /** True when the package is worth more than the carrier will insure: review it before shipping. */
  needsManualReview: boolean;
  coveredValueCents: number;
}

/**
 * Additional insurance for a whole package, from its total declared value.
 * Bought once per package, never per card.
 */
export function insurancePremium(packageValueCents: number, s: InsuranceSchedule): InsuranceQuote {
  const value = Math.max(0, Math.round(packageValueCents));
  if (value <= s.includedCoverageCents) {
    return { premiumCents: 0, includedOnly: true, needsManualReview: false, coveredValueCents: value };
  }
  const brackets = [...s.brackets].sort((a, b) => a.maxValueCents - b.maxValueCents);
  const needsManualReview = value > s.maxInsurableCents;
  const insured = Math.min(value, s.maxInsurableCents);
  for (const b of brackets) {
    if (insured <= b.maxValueCents) {
      return { premiumCents: b.premiumCents, includedOnly: b.premiumCents === 0, needsManualReview, coveredValueCents: insured };
    }
  }
  const last = brackets[brackets.length - 1];
  const lastMax = last ? last.maxValueCents : s.includedCoverageCents;
  const lastPremium = last ? last.premiumCents : 0;
  const steps = s.stepCents > 0 ? Math.ceil((insured - lastMax) / s.stepCents) : 0;
  return {
    premiumCents: lastPremium + steps * s.stepPremiumCents,
    includedOnly: false,
    needsManualReview,
    coveredValueCents: insured,
  };
}

// ---------------------------------------------------------------- allocation

/**
 * Split a package- or order-level cost across cards in proportion to each
 * card's Final Selling Price (agreement 4.5). Shares are whole cents and always
 * sum to the total; leftover cents go to the highest-priced cards first
 * (earliest index on a tie), so the split is deterministic.
 */
export function allocateByPrice(totalCents: number, priceCents: readonly number[]): number[] {
  const n = priceCents.length;
  if (n === 0) return [];
  const total = Math.round(totalCents);
  const weights = priceCents.map((p) => Math.max(0, Math.round(p)));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    // Nothing to weigh by: split evenly.
    const base = Math.trunc(total / n);
    const out = new Array<number>(n).fill(base);
    let rest = total - base * n;
    for (let i = 0; rest !== 0; i = (i + 1) % n) {
      out[i] += Math.sign(rest);
      rest -= Math.sign(rest);
    }
    return out;
  }
  const out = weights.map((w) => Math.trunc((total * w) / sum));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w || a.i - b.i);
  for (let k = 0; rest !== 0; k = (k + 1) % n) {
    out[order[k].i] += Math.sign(rest);
    rest -= Math.sign(rest);
  }
  return out;
}

// ---------------------------------------------------------------- settlement

export interface SettlementInput {
  finalPriceCents: number;
  marketplaceFeeCents: number;
  processingFeeCents: number;
  /** Outbound postage attributable to this card, before the buyer-shipping credit. */
  postageCents: number;
  /** What the buyer paid for shipping, attributable to this card. Credited against postage only. */
  buyerShippingCents: number;
  /** Additional insurance premium attributable to this card (0 when declined). */
  insuranceCents: number;
  /** Other expenses the consignor approved in writing. */
  otherExpenseCents: number;
}

export interface Settlement {
  finalPriceCents: number;
  marketplaceFeeCents: number;
  processingFeeCents: number;
  /** Postage minus buyer-paid shipping, never below 0 (an excess is neither paid nor charged). */
  netPostageCents: number;
  insuranceCents: number;
  otherExpenseCents: number;
  totalExpensesCents: number;
  netSaleCents: number;
  commissionRateBps: number;
  commissionCents: number;
  payoutCents: number;
}

/** One card's settlement. Used both for estimates and for actual, recorded sales. */
export function settle(input: SettlementInput, tiers: readonly CommissionTier[] = DEFAULT_COMMISSION_TIERS): Settlement {
  const price = Math.max(0, Math.round(input.finalPriceCents));
  const nn = (v: number) => Math.max(0, Math.round(v));
  const marketplace = nn(input.marketplaceFeeCents);
  const processing = nn(input.processingFeeCents);
  const netPostage = Math.max(0, nn(input.postageCents) - nn(input.buyerShippingCents));
  const insurance = nn(input.insuranceCents);
  const other = nn(input.otherExpenseCents);
  const expenses = marketplace + processing + netPostage + insurance + other;
  const net = Math.max(0, price - expenses);
  const rate = commissionRateBps(price, tiers);
  const commission = net > 0 ? applyBps(net, rate) : 0;
  return {
    finalPriceCents: price,
    marketplaceFeeCents: marketplace,
    processingFeeCents: processing,
    netPostageCents: netPostage,
    insuranceCents: insurance,
    otherExpenseCents: other,
    totalExpensesCents: expenses,
    netSaleCents: net,
    commissionRateBps: rate,
    commissionCents: commission,
    payoutCents: net - commission,
  };
}

// ---------------------------------------------------------------- estimator

/** What a buyer typically pays on a one-card order on one channel. */
export interface BuyerTerms {
  /** Shipping charged to the buyer. */
  shippingCents: number;
  /** Item price at or above which the buyer pays no shipping (the website's free-shipping threshold). */
  freeShippingAtCents: number | null;
  /** Sales tax the channel collects from the buyer, in bps. 0 on our own checkout. */
  salesTaxBps: number;
}

/** The shipping a buyer is estimated to pay on a one-card order. */
export function buyerShippingFor(terms: BuyerTerms | undefined, priceCents: number): number {
  if (!terms) return 0;
  if (terms.freeShippingAtCents != null && priceCents >= terms.freeShippingAtCents) return 0;
  return Math.max(0, Math.round(terms.shippingCents));
}

export interface EstimateSettings {
  commissionTiers: readonly CommissionTier[];
  channels: Partial<Record<ConsignmentChannel, ChannelFeeSchedule>>;
  insurance: InsuranceSchedule;
  /** Typical USPS Ground Advantage postage for one card, used when no real rate is available. */
  defaultPostageCents: number;
  /** What a buyer typically pays on a one-card order, per channel. */
  buyerTerms: Partial<Record<ConsignmentChannel, BuyerTerms>>;
}

export interface EstimateInput {
  priceCents: number;
  channel: ConsignmentChannel;
  additionalInsurance: boolean;
  /** Overrides defaultPostageCents (e.g. a real rate quote). */
  postageCents?: number;
}

export interface Estimate extends Settlement {
  channel: ConsignmentChannel;
  postageCents: number;
  buyerShippingCents: number;
  salesTaxCents: number;
  /** Where the postage figure came from. */
  postageSource: "default" | "quote";
  insurance: InsuranceQuote;
  /** Premium if insurance were bought, whether or not it was elected. */
  potentialInsuranceCents: number;
}

/** One estimated payout. Returns null when the channel has no fee schedule configured. */
export function estimatePayout(input: EstimateInput, s: EstimateSettings): Estimate | null {
  const schedule = s.channels[input.channel];
  if (!schedule) return null;
  const price = Math.max(0, Math.round(input.priceCents));
  const terms = s.buyerTerms[input.channel];
  const buyerShipping = buyerShippingFor(terms, price);
  const salesTax = applyBps(price + buyerShipping, Math.max(0, terms?.salesTaxBps ?? 0));
  const fees = channelFees(schedule, { itemCents: price, buyerShippingCents: buyerShipping, salesTaxCents: salesTax });
  const postage = Math.max(0, Math.round(input.postageCents ?? s.defaultPostageCents));
  const quote = insurancePremium(price, s.insurance);
  const settlement = settle(
    {
      finalPriceCents: price,
      marketplaceFeeCents: fees.marketplaceFeeCents,
      processingFeeCents: fees.processingFeeCents,
      postageCents: postage,
      buyerShippingCents: buyerShipping,
      insuranceCents: input.additionalInsurance ? quote.premiumCents : 0,
      otherExpenseCents: 0,
    },
    s.commissionTiers,
  );
  return {
    ...settlement,
    channel: input.channel,
    postageCents: postage,
    buyerShippingCents: buyerShipping,
    salesTaxCents: salesTax,
    postageSource: input.postageCents == null ? "default" : "quote",
    insurance: quote,
    potentialInsuranceCents: quote.premiumCents,
  };
}

export interface InsuranceComparison {
  withInsurance: Estimate;
  withoutInsurance: Estimate;
  /** How much less the consignor is estimated to receive with insurance. */
  payoutDifferenceCents: number;
}

export function compareInsurance(input: Omit<EstimateInput, "additionalInsurance">, s: EstimateSettings): InsuranceComparison | null {
  const withInsurance = estimatePayout({ ...input, additionalInsurance: true }, s);
  const withoutInsurance = estimatePayout({ ...input, additionalInsurance: false }, s);
  if (!withInsurance || !withoutInsurance) return null;
  return { withInsurance, withoutInsurance, payoutDifferenceCents: withoutInsurance.payoutCents - withInsurance.payoutCents };
}

/** Side-by-side estimates for every channel that has a schedule, in a fixed order. */
export function compareChannels(
  input: Omit<EstimateInput, "channel">,
  s: EstimateSettings,
  channels: readonly ConsignmentChannel[] = CONSIGNMENT_CHANNELS,
): Estimate[] {
  return channels.map((channel) => estimatePayout({ ...input, channel }, s)).filter((e): e is Estimate => e != null);
}

/** "20%" / "10.75%" from basis points. */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0+$/, "")}%`;
}
