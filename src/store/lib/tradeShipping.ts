// Shipping our cards to a trade customer, and the minimum a trade starts at
// (Trade Center). Shared by the trade cart, the trade page, admin Trades and
// the server; the database works the fee out the same way
// (trade_shipping_fee) and decides what's charged.
//
//   * Our cards (their retail value) must add up to at least the minimum,
//     $75 by default, to start or send a trade. Customers can add less.
//   * Shipping our cards: $3.99 under $200 of our cards, free from $200 (the
//     store owner sets all three). It's paid by card with the final payment,
//     never out of trade credit, which covers cards only.
//   * Customers ship their own cards to us, tracked, at their cost: that's a
//     different shipment from this one.
//
// Pure module: no React, browser, Node or Supabase imports. Money is whole cents.

export interface ShippingTerms {
  /** Under the free-shipping threshold. */
  shipFeeCents: number;
  /** Our cards worth this much or more ship for freeShipFeeCents. */
  freeShipThresholdCents: number;
  /** Normally 0. */
  freeShipFeeCents: number;
}

export const DEFAULT_SHIPPING_TERMS: ShippingTerms = { shipFeeCents: 399, freeShipThresholdCents: 20000, freeShipFeeCents: 0 };

/** Shipping our cards to the customer for this much of our cards (nothing for no cards). */
export function tradeShippingCents(wantedCents: number, terms: ShippingTerms): number {
  if (wantedCents <= 0) return 0;
  return wantedCents >= terms.freeShipThresholdCents ? terms.freeShipFeeCents : terms.shipFeeCents;
}

/** Shipping as a customer reads it: "$3.99", "FREE", or "$0.00" before there are any of our cards. */
export function shippingLabel(shippingCents: number, wantedCents: number): string {
  if (shippingCents > 0 || wantedCents <= 0) {
    return (shippingCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  return "FREE";
}

/** "$25", or "$25.50" when there are cents; "$1,250" for big amounts. */
export function moneyShort(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

/** The market value of their cards it takes for trade credit to cover `wantedCents` of ours, to the cent. */
export function requiredValueCents(wantedCents: number, ratePercent: number, feeCents = 0): number {
  if (wantedCents <= 0 || ratePercent <= 0) return 0;
  return Math.ceil(((wantedCents + feeCents) * 100) / ratePercent);
}

/** Below the minimum, the words for how much is missing; at or above it, that it's met. */
export function minimumMessage(wantedCents: number, minimumCents: number): string {
  if (wantedCents >= minimumCents) return "Your trade meets the minimum value requirement!";
  return `Add ${moneyShort(minimumCents - wantedCents)} more in cards to reach the ${moneyShort(minimumCents)} minimum trade value!`;
}

export type TradeProgressStage = "minimum" | "shipping" | "qualified";

export interface TradeProgress {
  /** minimum: under the minimum; shipping: on the way to free shipping; qualified: free (or reduced) shipping. */
  stage: TradeProgressStage;
  wantedCents: number;
  minimumCents: number;
  thresholdCents: number;
  /** Shipping our cards as the selection stands (charged by card at the end). */
  shippingCents: number;
  /** To the next milestone: the minimum, then free shipping. 0 once qualified. */
  neededCents: number;
  /** The headline. */
  message: string;
  minimumMet: boolean;
  /** How full the bar is, 0–100 (the free-shipping threshold is 100). */
  percent: number;
  /** Where the minimum sits on the bar, 0–100. */
  minimumPercent: number;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 1000) / 10));
}

/**
 * Where a selection of our cards stands: under the minimum ("Add $25 more to
 * start your trade!"), on the way to free shipping ("You’re $100 away…", or
 * within a quarter of the threshold "Add just $25 more to unlock…"), or there.
 */
export function tradeProgress(wantedCents: number, terms: ShippingTerms & { minTradeValueCents: number }): TradeProgress {
  const minimumCents = Math.max(terms.minTradeValueCents, 0);
  const thresholdCents = terms.freeShipThresholdCents;
  const shippingCents = tradeShippingCents(wantedCents, terms);
  const prize = terms.freeShipFeeCents > 0 ? `${moneyShort(terms.freeShipFeeCents)} shipping` : "FREE shipping";
  const base = {
    wantedCents,
    minimumCents,
    thresholdCents,
    shippingCents,
    minimumMet: wantedCents >= minimumCents,
    percent: pct(wantedCents, thresholdCents),
    minimumPercent: pct(minimumCents, thresholdCents),
  };
  if (wantedCents < minimumCents) {
    const neededCents = minimumCents - wantedCents;
    return { ...base, stage: "minimum", neededCents, message: `Add ${moneyShort(neededCents)} more to start your trade!` };
  }
  if (wantedCents < thresholdCents) {
    const neededCents = thresholdCents - wantedCents;
    const close = neededCents <= thresholdCents / 4;
    return {
      ...base,
      stage: "shipping",
      neededCents,
      message: close ? `Add just ${moneyShort(neededCents)} more to unlock ${prize}!` : `You’re ${moneyShort(neededCents)} away from ${prize}!`,
    };
  }
  return {
    ...base,
    stage: "qualified",
    neededCents: 0,
    message: terms.freeShipFeeCents > 0 ? `Your trade qualifies for ${prize}!` : "Your trade qualifies for FREE tracked shipping!",
  };
}

// ---------------------------------------------------------------------------
// Shipping their cards to us: the words the shipping step, the emails and
// the server share
// ---------------------------------------------------------------------------

/** The notice the shipping step always shows. */
export const PROTECT_YOUR_CARDS = {
  title: "Protect Your Cards During Shipping",
  paragraphs: [
    "Please package your cards carefully! We recommend protective sleeves, rigid card protection, and a padded envelope at a minimum. All incoming trade shipments must include tracking.",
    "For valuable shipments, consider purchasing shipping insurance.",
    "Cards will be inspected for authenticity and condition when they arrive at Geega Games. Your final trade value will reflect the cards received and their verified condition.",
  ],
  /** What damage in the mail means, said plainly. */
  damage:
    "If a card is damaged on the way, its final value reflects the damage. You'll see the final value, with every change and its reason, before anything is final: accept it, ask for an adjustment, or decline it with no penalty.",
} as const;

/** What customers confirm before they send a tracking number (a new number needs it again). */
export const PACKAGING_CONFIRMATION =
  "I confirm that my cards are securely packaged, protected against bending and movement, and shipped using a tracked shipping service.";

/** The short version, for the shipping email. */
export const PACKING_CHECKLIST: readonly string[] = [
  "Sleeve every card, then add rigid protection: a toploader, semi-rigid holder or snug card box. A bubble mailer alone doesn't stop bending.",
  "Use a padded bubble mailer at a minimum; for many cards or valuable ones, a sturdy box. Fill empty space so nothing moves, and keep tape and tight rubber bands off the cards.",
  "Ship with tracking (USPS Ground Advantage, UPS Ground or another tracked service). For valuable shipments, consider insurance and signature confirmation.",
  "Photos of your cards and the sealed package can help if anything goes wrong in the mail.",
];

/** The collapsible guide on the shipping step. */
export const SHIPPING_GUIDE_TITLE = "New to Shipping Magic Cards? Start Here!";

/** Stays visible with the guide collapsed. */
export const SHIPPING_GUIDE_REMINDER =
  "Sleeve every card, add rigid protection, pack a padded bubble mailer (at a minimum) so nothing moves, and ship with tracking.";

export type ShippingIllustration = "sleeve" | "toploader" | "stack" | "mailer" | "box";

export interface ShippingGuideStep {
  title: string;
  intro: string;
  points: readonly string[];
  /** Pictures of doing it right. */
  illustrations: readonly { kind: ShippingIllustration; caption: string }[];
}

export const SHIPPING_GUIDE: readonly ShippingGuideStep[] = [
  {
    title: "Protect your cards",
    intro: "Every card needs its own protection before it goes in the package.",
    points: [
      "Put each card in a protective sleeve.",
      "Add rigid protection: a toploader, a semi-rigid holder, or a card box sized to fit.",
      "Make sure cards can't bend, rub against each other or slide around.",
      "Keep adhesive tape off the cards themselves, and don't overtighten rubber bands.",
      "Never ship loose, unprotected cards.",
    ],
    illustrations: [
      { kind: "sleeve", caption: "A card in a sleeve" },
      { kind: "toploader", caption: "The sleeved card in a toploader" },
    ],
  },
  {
    title: "Package your cards",
    intro: "Use a padded bubble mailer with rigid card protection inside, at a minimum.",
    points: [
      "A bubble mailer on its own doesn't stop cards bending: the rigid protection inside does.",
      "For lots of cards or valuable ones, use a sturdy cardboard box instead.",
      "Fill any empty space with cushioning so nothing can move.",
      "Seal the package securely.",
    ],
    illustrations: [
      { kind: "stack", caption: "Toploaders taped together, tape on the toploaders only" },
      { kind: "mailer", caption: "Rigid protection inside a padded bubble mailer" },
      { kind: "box", caption: "A sturdy box, sealed, for bigger shipments" },
    ],
  },
  {
    title: "Use tracked shipping",
    intro: "Every trade shipment needs tracking. You buy the label for shipping your cards to us.",
    points: [
      "USPS Ground Advantage and UPS Ground both include tracking; any reputable tracked service works.",
      "For valuable shipments, consider adding insurance and signature confirmation. What insurance covers, and whether a claim is paid, is up to the carrier.",
    ],
    illustrations: [],
  },
  {
    title: "Photograph your shipment (optional)",
    intro: "Photos can help if anything goes wrong in the mail. You don't need to send them to us unless we ask.",
    points: [
      "Your cards before you pack them.",
      "Your cards in their sleeves and rigid protection.",
      "The packed package before you seal it.",
      "The sealed, labeled package.",
    ],
    illustrations: [],
  },
  {
    title: "Add your tracking number",
    intro: "Enter the carrier, the tracking number and, if you like, the day you shipped, below.",
    points: [
      "We link your tracking number to the carrier's tracking page, here and in your trade emails.",
      "Your shipment counts once the carrier scans your package. A tracking number on its own doesn't mark it shipped or delivered.",
    ],
    illustrations: [],
  },
];
