import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMISSION_TIERS,
  allocateByPrice,
  applyBps,
  channelFees,
  commissionRateBps,
  compareChannels,
  compareInsurance,
  estimatePayout,
  formatBps,
  insurancePremium,
  parseDollarsToCents,
  settle,
  type ChannelFeeSchedule,
  type EstimateSettings,
  type InsuranceSchedule,
} from "../src/store/lib/consignmentMath";

// The consignment payout math (agreement sections 4 and 5). The SQL mirror is
// checked against these functions in tests/consignmentFoundationDb.test.ts.

const insurance: InsuranceSchedule = {
  includedCoverageCents: 10000,
  brackets: [
    { maxValueCents: 10000, premiumCents: 0 },
    { maxValueCents: 20000, premiumCents: 450 },
    { maxValueCents: 30000, premiumCents: 455 },
    { maxValueCents: 40000, premiumCents: 605 },
    { maxValueCents: 50000, premiumCents: 755 },
    { maxValueCents: 60000, premiumCents: 905 },
  ],
  stepCents: 10000,
  stepPremiumCents: 150,
  maxInsurableCents: 500000,
};

const website: ChannelFeeSchedule = {
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
const tcgplayer: ChannelFeeSchedule = {
  ...website,
  channel: "tcgplayer",
  marketplaceBps: 1075,
  marketplaceBase: "item_shipping",
  processingBps: 250,
  processingFixedCents: 30,
};
const ebay: ChannelFeeSchedule = {
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
  processingBase: "item_shipping_tax",
};

const settings: EstimateSettings = {
  commissionTiers: DEFAULT_COMMISSION_TIERS,
  channels: { website, tcgplayer, ebay },
  insurance,
  defaultPostageCents: 500,
  buyerTerms: {
    website: { shippingCents: 550, freeShippingAtCents: 7500, salesTaxBps: 0 },
    tcgplayer: { shippingCents: 0, freeShippingAtCents: null, salesTaxBps: 700 },
    ebay: { shippingCents: 0, freeShippingAtCents: null, salesTaxBps: 700 },
  },
};

describe("commission tiers", () => {
  it("charges 20% on a card sold at exactly $150.00 and 10% at $150.01", () => {
    expect(commissionRateBps(15000, DEFAULT_COMMISSION_TIERS)).toBe(2000);
    expect(commissionRateBps(15001, DEFAULT_COMMISSION_TIERS)).toBe(1000);
    expect(commissionRateBps(1, DEFAULT_COMMISSION_TIERS)).toBe(2000);
  });

  it("applies the rate to the Net Sale Amount, not the selling price", () => {
    const s = settle({
      finalPriceCents: 15000,
      marketplaceFeeCents: 0,
      processingFeeCents: 465,
      postageCents: 500,
      buyerShippingCents: 0,
      insuranceCents: 0,
      otherExpenseCents: 0,
    });
    expect(s.netSaleCents).toBe(14035);
    expect(s.commissionCents).toBe(2807);
    expect(s.payoutCents).toBe(11228);
  });

  it("rounds halves up, once per line", () => {
    expect(applyBps(25, 2000)).toBe(5);
    expect(applyBps(2, 2500)).toBe(1); // 0.5 → 1
    expect(applyBps(1, 2000)).toBe(0); // 0.2 → 0
  });
});

describe("settlement", () => {
  it("reproduces the spec's example: $200 website sale pays $166.05", () => {
    const s = settle({
      finalPriceCents: 20000,
      marketplaceFeeCents: 0,
      processingFeeCents: 600,
      postageCents: 500,
      buyerShippingCents: 0,
      insuranceCents: 450,
      otherExpenseCents: 0,
    });
    expect(s).toMatchObject({ netSaleCents: 18450, commissionRateBps: 1000, commissionCents: 1845, payoutCents: 16605 });
  });

  it("credits buyer-paid shipping against postage only, never paying out the excess", () => {
    const covered = settle({
      finalPriceCents: 1000,
      marketplaceFeeCents: 0,
      processingFeeCents: 0,
      postageCents: 400,
      buyerShippingCents: 550,
      insuranceCents: 0,
      otherExpenseCents: 0,
    });
    expect(covered.netPostageCents).toBe(0);
    expect(covered.netSaleCents).toBe(1000);
    const partly = settle({ ...covered, postageCents: 700, buyerShippingCents: 550 });
    expect(partly.netPostageCents).toBe(150);
  });

  it("never lets expenses take the net below zero, and charges no commission then", () => {
    const s = settle({
      finalPriceCents: 100,
      marketplaceFeeCents: 50,
      processingFeeCents: 33,
      postageCents: 500,
      buyerShippingCents: 0,
      insuranceCents: 0,
      otherExpenseCents: 0,
    });
    expect(s).toMatchObject({ netSaleCents: 0, commissionCents: 0, payoutCents: 0 });
  });

  it("counts each expense once", () => {
    const s = settle({
      finalPriceCents: 10000,
      marketplaceFeeCents: 100,
      processingFeeCents: 200,
      postageCents: 300,
      buyerShippingCents: 0,
      insuranceCents: 400,
      otherExpenseCents: 500,
    });
    expect(s.totalExpensesCents).toBe(1500);
    expect(s.netSaleCents).toBe(8500);
  });
});

describe("channel fees", () => {
  it("charges the website processing only, on the whole charge", () => {
    expect(channelFees(website, { itemCents: 20000, buyerShippingCents: 0, salesTaxCents: 0 })).toEqual({
      marketplaceFeeCents: 0,
      processingFeeCents: 610,
    });
  });

  it("charges eBay on shipping and sales tax too, with no separate processing", () => {
    const f = channelFees(ebay, { itemCents: 10000, buyerShippingCents: 500, salesTaxCents: 735 });
    // 13.25% of $112.35 = $14.886 → $14.89, + $0.40 per order.
    expect(f).toEqual({ marketplaceFeeCents: 1489 + 40, processingFeeCents: 0 });
  });

  it("uses eBay's lower rate above the per-item threshold, and the small-order fee", () => {
    const big = channelFees(ebay, { itemCents: 1000000, buyerShippingCents: 0, salesTaxCents: 0 });
    expect(big.marketplaceFeeCents).toBe(applyBps(750000, 1325) + applyBps(250000, 235) + 40);
    const small = channelFees(ebay, { itemCents: 900, buyerShippingCents: 0, salesTaxCents: 0 });
    expect(small.marketplaceFeeCents).toBe(applyBps(900, 1325) + 30);
  });
});

describe("insurance", () => {
  it("buys nothing extra up to the included $100", () => {
    expect(insurancePremium(10000, insurance)).toMatchObject({ premiumCents: 0, includedOnly: true });
    expect(insurancePremium(5000, insurance).premiumCents).toBe(0);
  });

  it("uses the brackets above $100, then $1.50 per $100 or part above $600", () => {
    expect(insurancePremium(10001, insurance).premiumCents).toBe(450);
    expect(insurancePremium(20001, insurance).premiumCents).toBe(455);
    expect(insurancePremium(60000, insurance).premiumCents).toBe(905);
    expect(insurancePremium(60001, insurance).premiumCents).toBe(1055);
    expect(insurancePremium(70000, insurance).premiumCents).toBe(1055);
    expect(insurancePremium(70001, insurance).premiumCents).toBe(1205);
  });

  it("flags a package worth more than the carrier insures for manual review", () => {
    const q = insurancePremium(600000, insurance);
    expect(q.needsManualReview).toBe(true);
    expect(q.coveredValueCents).toBe(500000);
    expect(insurancePremium(500000, insurance).needsManualReview).toBe(false);
  });
});

describe("allocation across cards in one package", () => {
  it("splits by price and always sums to the total", () => {
    expect(allocateByPrice(500, [10000, 5000, 5000])).toEqual([250, 125, 125]);
    const shares = allocateByPrice(455, [12000, 9000, 9000]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(455);
    expect(shares).toEqual([183, 136, 136]);
  });

  it("gives leftover cents to the highest-priced card", () => {
    expect(allocateByPrice(100, [100, 100, 100])).toEqual([34, 33, 33]);
    expect(allocateByPrice(100, [100, 200, 100])).toEqual([25, 50, 25]);
    expect(allocateByPrice(101, [100, 200, 100])).toEqual([25, 51, 25]);
  });

  it("splits evenly when nothing has a price", () => {
    expect(allocateByPrice(10, [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocateByPrice(10, [])).toEqual([]);
  });
});

describe("estimator", () => {
  it("estimates a $200 website sale with insurance", () => {
    const e = estimatePayout({ priceCents: 20000, channel: "website", additionalInsurance: true }, settings)!;
    expect(e.buyerShippingCents).toBe(0); // free shipping at $75
    expect(e.processingFeeCents).toBe(610);
    expect(e.insuranceCents).toBe(450);
    expect(e.netSaleCents).toBe(20000 - 610 - 500 - 450);
    expect(e.commissionRateBps).toBe(1000);
    expect(e.payoutCents).toBe(18440 - applyBps(18440, 1000));
    expect(e.postageSource).toBe("default");
  });

  it("credits the website's $5.50 shipping on a card under $75", () => {
    const e = estimatePayout({ priceCents: 2000, channel: "website", additionalInsurance: false }, settings)!;
    expect(e.buyerShippingCents).toBe(550);
    expect(e.netPostageCents).toBe(0);
  });

  it("compares with and without insurance, the difference being the premium less its commission", () => {
    const c = compareInsurance({ priceCents: 20000, channel: "website" }, settings)!;
    expect(c.withInsurance.insuranceCents).toBe(450);
    expect(c.withoutInsurance.insuranceCents).toBe(0);
    expect(c.payoutDifferenceCents).toBe(405);
  });

  it("charges no insurance for a card under $100 either way", () => {
    const c = compareInsurance({ priceCents: 9000, channel: "website" }, settings)!;
    expect(c.payoutDifferenceCents).toBe(0);
  });

  it("compares channels, each on its own fee base", () => {
    const rows = compareChannels({ priceCents: 20000, additionalInsurance: false }, settings);
    expect(rows.map((r) => r.channel)).toEqual(["website", "tcgplayer", "ebay"]);
    const [web, tcg, eb] = rows;
    expect(web.marketplaceFeeCents).toBe(0);
    expect(tcg.marketplaceFeeCents).toBe(applyBps(20000, 1075));
    expect(tcg.processingFeeCents).toBe(applyBps(20000 + 1400, 250) + 30);
    expect(eb.processingFeeCents).toBe(0);
    expect(eb.marketplaceFeeCents).toBe(applyBps(21400, 1325) + 40);
    expect(web.payoutCents).toBeGreaterThan(tcg.payoutCents);
  });

  it("uses a real postage quote when one is given", () => {
    const e = estimatePayout({ priceCents: 20000, channel: "website", additionalInsurance: false, postageCents: 412 }, settings)!;
    expect(e.postageCents).toBe(412);
    expect(e.postageSource).toBe("quote");
  });

  it("returns null for a channel with no rates", () => {
    expect(estimatePayout({ priceCents: 1000, channel: "ebay", additionalInsurance: false }, { ...settings, channels: {} })).toBeNull();
  });
});

describe("input helpers", () => {
  it("parses dollar input safely", () => {
    expect(parseDollarsToCents("200")).toBe(20000);
    expect(parseDollarsToCents("$1,234.5")).toBe(123450);
    expect(parseDollarsToCents("150.01")).toBe(15001);
    expect(parseDollarsToCents("0.1")).toBe(10);
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });

  it("formats basis points", () => {
    expect(formatBps(2000)).toBe("20%");
    expect(formatBps(1075)).toBe("10.75%");
    expect(formatBps(235)).toBe("2.35%");
    expect(formatBps(290)).toBe("2.9%");
  });
});
