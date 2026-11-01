import type { TradeTerms } from "./tradeCenter";

// The trade terms the website advertises in static HTML.
//
// The trade-in landing page (/trade-in-magic-cards) is prerendered at build
// time so search engines read the rate without running JavaScript, and the
// live terms (/api/trade-center) arrive only once the page runs. This
// snapshot of the Trade Center settings fills the page until then. In the
// browser the live terms replace it, so a customer always sees the current
// settings; what's here only has to match them closely enough that the
// page doesn't change under a reader's eyes.
//
// When you change the credit rate or the minimums in the Trade Center
// settings, update the matching value here and redeploy. The admin settings
// panel points this out when the two disagree (TradeSettingsPanel).

export const ADVERTISED_TRADE_TERMS: TradeTerms = {
  enabled: true,
  paused: false,
  pauseMessage: "We're not taking new trades right now. Trades already underway carry on as normal.",
  creditRatePercent: 80,
  minCardValueCents: 1000,
  conditionPercents: { NM: 100, LP: 90, MP: 75, HP: 60, DMG: 40 },
  draftDays: 14,
  revisionHours: 168,
  confirmationHours: 48,
  shipDaysNew: 3,
  shipDaysTier1: 4,
  shipDaysTier2: 5,
  loyaltyTier1Trades: 3,
  loyaltyTier2Trades: 10,
  scanGraceHours: 24,
  excludedDates: [],
  paymentDueDays: 7,
  disputeWindowDays: 14,
  maxActiveTrades: 2,
  maxWantedLines: 80,
  maxOfferedLines: 100,
  minTradeValueCents: 12500,
  maxTradeValueCents: null,
  processingFeeCents: 0,
  cashPayoutEnabled: false,
  shippingPaidBy: "customer",
  shipFeeCents: 399,
  freeShipThresholdCents: 20000,
  freeShipFeeCents: 0,
  packingInstructions:
    "Put each card in a penny sleeve and a toploader or card saver, keep them together in a team bag, and pack them snugly in a bubble mailer or small box so nothing moves. Write your trade ID on a slip of paper inside. Please use a tracked shipping service.",
  returnPolicy:
    "If you decline the final offer, or we can't accept a card, we'll mail those cards back to you. We'll confirm any return shipping cost with you before we send them. We never keep a card you haven't agreed to trade.",
  excludedSetCodes: [],
  excludedCardNames: [],
  overstockThreshold: 0,
  hasShipToAddress: true,
  depositsEnabled: true,
  depositThresholdCents: 30000,
  depositBand1MaxCents: 10000,
  depositBand2MaxCents: 30000,
  depositBand3MaxCents: 60000,
  depositBand1Cents: 500,
  depositBand2Cents: 1000,
  depositBand3Cents: 2000,
  depositBand4Cents: 3000,
  depositTerms: "To reserve your selected cards, a refundable deposit may be required.",
  depositTermsVersion: 2,
  localPickupEnabled: true,
  localPickupArea: "the St. Louis area",
  localMeetDays: 3,
  localPickupDetails:
    "Once your trade is confirmed, we'll message you here to set a time and a public place to meet. Bring the cards you're trading in: we'll look them over together and settle the trade on the spot.",
  localMeetSpotName: "Schnuck's at Olive and Mason",
  localMeetSpotAddress: "12756 Olive Blvd St. Louis, MO 63141",
  localCreditRatePercent: 80,
  localMinCardValueCents: 1000,
  localMinTradeValueCents: 10000,
  localCashPayoutEnabled: false,
};

/** The values the website states in words; the settings panel warns when the live ones differ. */
export const ADVERTISED_TRADE_KEYS = [
  "creditRatePercent",
  "minCardValueCents",
  "minTradeValueCents",
  "localCreditRatePercent",
  "localMinCardValueCents",
  "localMinTradeValueCents",
] as const satisfies readonly (keyof TradeTerms)[];

/** The advertised values that disagree with `live`, as "creditRatePercent: site says 80, settings say 75". */
export function advertisedMismatches(live: Pick<TradeTerms, (typeof ADVERTISED_TRADE_KEYS)[number]>): string[] {
  return ADVERTISED_TRADE_KEYS.filter((key) => live[key] !== ADVERTISED_TRADE_TERMS[key]).map(
    (key) => `${key}: site says ${ADVERTISED_TRADE_TERMS[key]}, settings say ${live[key]}`,
  );
}
