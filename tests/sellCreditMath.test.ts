import { describe, expect, it } from "vitest";
import { creditToIssueCents, offeredCreditCents } from "../src/store/lib/sellTypes";

// Mirrors the sell_submission_issue_store_credit trigger (migration
// 20261102120000): the admin drawer previews exactly what the DB will issue.
describe("store credit on sell offers", () => {
  it("offers the credit amount staff set, or PayPal + 20% on an offer sent before credit amounts", () => {
    expect(offeredCreditCents(35000, 40000)).toBe(40000);
    expect(offeredCreditCents(35000, null)).toBe(42000);
    expect(offeredCreditCents(35000, null, 15)).toBe(40250);
  });

  it("issues the credit offered when the purchase amount wasn't changed", () => {
    const lead = { offerValueCents: 35000, creditOfferCents: 40000, purchaseAmountCents: null, storeCreditBonusPercent: null };
    expect(creditToIssueCents(lead)).toBe(40000);
    expect(creditToIssueCents({ ...lead, purchaseAmountCents: 35000 })).toBe(40000);
  });

  it("scales the credit offered when staff settle on a different amount after inspection", () => {
    const lead = { offerValueCents: 35000, creditOfferCents: 40000, purchaseAmountCents: 28000, storeCreditBonusPercent: null };
    expect(creditToIssueCents(lead)).toBe(32000);
  });

  it("keeps the old rule for offers with no credit amount", () => {
    const lead = { offerValueCents: 35000, creditOfferCents: null, purchaseAmountCents: null, storeCreditBonusPercent: 20 };
    expect(creditToIssueCents(lead)).toBe(42000);
    expect(creditToIssueCents({ ...lead, purchaseAmountCents: 30000 })).toBe(36000);
    expect(creditToIssueCents({ ...lead, offerValueCents: null })).toBe(0);
  });
});
