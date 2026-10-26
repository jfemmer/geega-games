import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIPPING_TERMS,
  PACKAGING_CONFIRMATION,
  PROTECT_YOUR_CARDS,
  SHIPPING_GUIDE,
  SHIPPING_GUIDE_TITLE,
  minimumMessage,
  moneyShort,
  requiredValueCents,
  shippingLabel,
  tradeProgress,
  tradeShippingCents,
} from "../src/store/lib/tradeShipping";
import { tradeComparison } from "../src/store/lib/tradeCenter";
import { acceptedCardCounts, economicsTotals, tradeEconomics } from "../src/store/lib/tradeEconomics";

// The money rules every trade screen, email and the server share (the
// database works shipping out the same way: tradeCenterDb.test.ts).

const TERMS = { ...DEFAULT_SHIPPING_TERMS, minTradeValueCents: 7500 };

describe("shipping our cards", () => {
  it("is $3.99 from $75 to $199.99 of our cards, and free from $200", () => {
    expect(tradeShippingCents(7500, DEFAULT_SHIPPING_TERMS)).toBe(399);
    expect(tradeShippingCents(10000, DEFAULT_SHIPPING_TERMS)).toBe(399);
    expect(tradeShippingCents(19999, DEFAULT_SHIPPING_TERMS)).toBe(399);
    expect(tradeShippingCents(20000, DEFAULT_SHIPPING_TERMS)).toBe(0);
    expect(tradeShippingCents(50000, DEFAULT_SHIPPING_TERMS)).toBe(0);
    // No cards, no shipping.
    expect(tradeShippingCents(0, DEFAULT_SHIPPING_TERMS)).toBe(0);
  });

  it("follows the store owner's settings", () => {
    const terms = { shipFeeCents: 599, freeShipThresholdCents: 15000, freeShipFeeCents: 199 };
    expect(tradeShippingCents(14999, terms)).toBe(599);
    expect(tradeShippingCents(15000, terms)).toBe(199);
  });

  it("reads the way customers see it", () => {
    expect(shippingLabel(399, 10000)).toBe("$3.99");
    expect(shippingLabel(0, 20000)).toBe("FREE");
    expect(shippingLabel(0, 0)).toBe("$0.00");
    expect(moneyShort(2500)).toBe("$25");
    expect(moneyShort(2550)).toBe("$25.50");
    expect(moneyShort(125000)).toBe("$1,250");
  });
});

describe("the minimum trade", () => {
  it("is our cards' retail value: $74.99 isn't enough, $75 is", () => {
    expect(minimumMessage(5000, 7500)).toBe("Add $25 more in cards to reach the $75 minimum trade value!");
    expect(minimumMessage(7499, 7500)).toBe("Add $0.01 more in cards to reach the $75 minimum trade value!");
    expect(minimumMessage(7500, 7500)).toBe("Your trade meets the minimum value requirement!");
    expect(minimumMessage(10000, 7500)).toBe("Your trade meets the minimum value requirement!");
  });

  it("takes $93.75 of their cards to cover $75 of ours at 80%, $250 for $200", () => {
    expect(requiredValueCents(7500, 80)).toBe(9375);
    expect(requiredValueCents(20000, 80)).toBe(25000);
    expect(requiredValueCents(15000, 80)).toBe(18750);
    // To the cent, rounding up so the credit always covers it.
    expect(requiredValueCents(8899, 80)).toBe(11124);
    expect(requiredValueCents(0, 80)).toBe(0);
  });
});

describe("the bar toward the minimum and free shipping", () => {
  it("says what's next at each stage, as the cards add up", () => {
    expect(tradeProgress(5000, TERMS)).toMatchObject({ stage: "minimum", message: "Add $25 more to start your trade!", neededCents: 2500, minimumMet: false });
    expect(tradeProgress(10000, TERMS)).toMatchObject({ stage: "shipping", message: "You’re $100 away from FREE shipping!", shippingCents: 399 });
    expect(tradeProgress(17500, TERMS)).toMatchObject({ stage: "shipping", message: "Add just $25 more to unlock FREE shipping!", neededCents: 2500 });
    expect(tradeProgress(20000, TERMS)).toMatchObject({ stage: "qualified", message: "Your trade qualifies for FREE tracked shipping!", shippingCents: 0, neededCents: 0 });
    expect(tradeProgress(50000, TERMS)).toMatchObject({ stage: "qualified", percent: 100 });
    // At the minimum exactly, it's on to free shipping.
    expect(tradeProgress(7500, TERMS)).toMatchObject({ stage: "shipping", message: "You’re $125 away from FREE shipping!", minimumMet: true });
  });

  it("knows where the minimum sits on the bar and how full it is", () => {
    expect(tradeProgress(5000, TERMS)).toMatchObject({ percent: 25, minimumPercent: 37.5 });
    expect(tradeProgress(0, TERMS)).toMatchObject({ percent: 0, stage: "minimum", message: "Add $75 more to start your trade!" });
  });

  it("names a reduced rate instead of free shipping when there is one", () => {
    const reduced = { ...TERMS, freeShipFeeCents: 199 };
    expect(tradeProgress(10000, reduced).message).toBe("You’re $100 away from $1.99 shipping!");
    expect(tradeProgress(20000, reduced).message).toBe("Your trade qualifies for $1.99 shipping!");
  });

  it("with no minimum, starts on the way to free shipping", () => {
    expect(tradeProgress(2000, { ...TERMS, minTradeValueCents: 0 })).toMatchObject({ stage: "shipping", minimumMet: true });
  });
});

describe("what a trade adds up to: credit covers our cards, shipping is paid by card", () => {
  const base = { ratePercent: 80, shipping: DEFAULT_SHIPPING_TERMS };

  it("$150 of our cards, $187.50 of theirs: the credit covers the cards, $3.99 shipping by card", () => {
    expect(tradeComparison({ ...base, wantedCents: 15000, offeredValueCents: 18750 })).toEqual({
      wantedCents: 15000,
      shippingCents: 399,
      offeredValueCents: 18750,
      creditCents: 15000,
      requiredValueCents: 18750,
      creditAppliedCents: 15000,
      cardBalanceCents: 0,
      cashDueCents: 399,
      excessCents: 0,
      moreValueNeededCents: 0,
    });
  });

  it("partial credit: the rest of our cards and shipping by card", () => {
    // $100 of ours, $100 of theirs: $80 credit, $20 left for the cards, plus $3.99.
    expect(tradeComparison({ ...base, wantedCents: 10000, offeredValueCents: 10000 })).toMatchObject({
      creditCents: 8000,
      creditAppliedCents: 8000,
      cardBalanceCents: 2000,
      cashDueCents: 2399,
      excessCents: 0,
      moreValueNeededCents: 2500,
    });
    // $200 of ours ships free: only the cards' balance.
    expect(tradeComparison({ ...base, wantedCents: 20000, offeredValueCents: 20000 })).toMatchObject({
      creditCents: 16000,
      cardBalanceCents: 4000,
      shippingCents: 0,
      cashDueCents: 4000,
    });
  });

  it("more credit than our cards: the rest stays as credit, and shipping is still paid by card", () => {
    expect(tradeComparison({ ...base, wantedCents: 10000, offeredValueCents: 15000 })).toMatchObject({
      creditCents: 12000,
      creditAppliedCents: 10000,
      cardBalanceCents: 0,
      excessCents: 2000,
      cashDueCents: 399,
    });
  });

  it("takes a processing fee off the credit, never off the rate", () => {
    expect(tradeComparison({ ...base, wantedCents: 10000, offeredValueCents: 12500, feeCents: 300 })).toMatchObject({
      creditCents: 9700,
      cardBalanceCents: 300,
      requiredValueCents: 12875,
    });
  });

  it("uses a trade's settled shipping when it has one", () => {
    expect(tradeComparison({ ...base, wantedCents: 10000, offeredValueCents: 12500, shippingCents: 0 }).cashDueCents).toBe(0);
  });
});

describe("internal trade economics (theoretical, not profit)", () => {
  it("$250 in, $200 out, $6 to ship, nothing charged: $50 gross, $44 after shipping", () => {
    const e = tradeEconomics({ finalValueCents: 25000, wantedTotalCents: 20000, shippingCents: 0, orderPostageCents: null, outboundPostageCents: null }, 600);
    expect(e).toEqual({
      incomingMarketCents: 25000,
      outgoingRetailCents: 20000,
      grossDifferenceCents: 5000,
      shippingChargedCents: 0,
      shippingCostCents: 600,
      shippingCostSource: "estimate",
      netShippingCents: 600,
      adjustedDifferenceCents: 4400,
    });
  });

  it("uses the label bought here, then postage staff recorded, then the estimate", () => {
    const t = { finalValueCents: 18750, wantedTotalCents: 15000, shippingCents: 399 };
    expect(tradeEconomics({ ...t, orderPostageCents: 510, outboundPostageCents: 450 }, 600)).toMatchObject({ shippingCostCents: 510, shippingCostSource: "label", netShippingCents: 111 });
    expect(tradeEconomics({ ...t, orderPostageCents: null, outboundPostageCents: 450 }, 600)).toMatchObject({ shippingCostCents: 450, shippingCostSource: "recorded", netShippingCents: 51 });
    // Charged more than it cost: net shipping is negative and adds to the difference.
    expect(tradeEconomics({ ...t, orderPostageCents: 300, outboundPostageCents: null }, 600)).toMatchObject({ netShippingCents: -99, adjustedDifferenceCents: 3849 });
    // No final value yet: nothing to count.
    expect(tradeEconomics({ ...t, finalValueCents: null, orderPostageCents: null, outboundPostageCents: null }, 600)).toBeNull();
  });

  it("totals the trades, and counts the singles and listings we took", () => {
    const rows = [
      tradeEconomics({ finalValueCents: 25000, wantedTotalCents: 20000, shippingCents: 0, orderPostageCents: null, outboundPostageCents: null }, 600)!,
      tradeEconomics({ finalValueCents: 10000, wantedTotalCents: 9000, shippingCents: 399, orderPostageCents: 450, outboundPostageCents: null }, 600)!,
    ];
    const cards = acceptedCardCounts(
      [
        { scryfallId: "a", cardName: "Sheoldred", finish: "nonfoil", condition: "NM", quantity: 2, unitCents: 8000 },
        { scryfallId: "a", cardName: "Sheoldred", finish: "nonfoil", condition: "NM", quantity: 1, unitCents: 8000 },
        { scryfallId: "a", cardName: "Sheoldred", finish: "foil", condition: "NM", quantity: 1, unitCents: 9500 },
        { scryfallId: "b", cardName: "Llanowar Elves", finish: "nonfoil", condition: "LP", quantity: 4, unitCents: 1499 },
        { scryfallId: "c", cardName: "Not taken", finish: "nonfoil", condition: "NM", quantity: 0, unitCents: 0 },
      ],
      1500,
    );
    expect(cards).toEqual({ acceptedSingles: 4, uniqueListings: 3 });
    expect(economicsTotals(rows, cards)).toEqual({
      trades: 2,
      incomingMarketCents: 35000,
      outgoingRetailCents: 29000,
      grossDifferenceCents: 6000,
      shippingChargedCents: 399,
      shippingCostCents: 1050,
      estimatedShipments: 1,
      netShippingCents: 651,
      adjustedDifferenceCents: 5349,
      averageOutgoingCents: 14500,
      acceptedSingles: 4,
      uniqueListings: 3,
    });
    expect(economicsTotals([], { acceptedSingles: 0, uniqueListings: 0 }).averageOutgoingCents).toBe(0);
  });
});

describe("the words on the shipping step", () => {
  it("keeps the notice and the confirmation exactly as written", () => {
    expect(PROTECT_YOUR_CARDS.title).toBe("Protect Your Cards During Shipping");
    expect(PROTECT_YOUR_CARDS.paragraphs).toEqual([
      "Please package your cards carefully! We recommend protective sleeves, rigid card protection, and a padded envelope at a minimum. All incoming trade shipments must include tracking.",
      "For valuable shipments, consider purchasing shipping insurance.",
      "Cards will be inspected for authenticity and condition when they arrive at Geega Games. Your final trade value will reflect the cards received and their verified condition.",
    ]);
    expect(PACKAGING_CONFIRMATION).toBe(
      "I confirm that my cards are securely packaged, protected against bending and movement, and shipped using a tracked shipping service.",
    );
  });

  it("walks a first-time shipper through five steps, with pictures of packing them right", () => {
    expect(SHIPPING_GUIDE_TITLE).toBe("New to Shipping Magic Cards? Start Here!");
    expect(SHIPPING_GUIDE.map((s) => s.title)).toEqual([
      "Protect your cards",
      "Package your cards",
      "Use tracked shipping",
      "Photograph your shipment (optional)",
      "Add your tracking number",
    ]);
    expect(SHIPPING_GUIDE.flatMap((s) => s.illustrations.map((i) => i.kind))).toEqual(["sleeve", "toploader", "stack", "mailer", "box"]);
    const text = SHIPPING_GUIDE.flatMap((s) => [s.intro, ...s.points]).join(" ");
    expect(text).toContain("USPS Ground Advantage and UPS Ground");
    expect(text).toContain("You buy the label");
    // Insurance is suggested, never promised.
    expect(text).toContain("What insurance covers, and whether a claim is paid, is up to the carrier.");
    expect(text).toContain("A tracking number on its own doesn't mark it shipped or delivered.");
  });
});
