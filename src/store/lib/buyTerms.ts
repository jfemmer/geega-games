// What Geega Games pays for Magic singles, and how soon a seller hears back:
// the one source for every sell page, guide, form and email that quotes them.
// Confirmed by the owner on 2026-11-02:
//
//   * Singles shipped to us: up to 70% of TCG low by PayPal Goods & Services,
//     on a tiered scale set by each card's price (the tiers themselves aren't
//     published).
//   * Store credit: 80% of TCG low, on singles worth $20 or more.
//   * An offer within 24 hours of a submission.
//
// Change a number here and every page follows. Don't add a claim (a bulk rate,
// a meetup rate, a credit rate under $20, which way the tiers run) without the
// owner confirming it. The rates are for singles shipped to us: keep "shipped"
// next to them wherever the copy also talks about meetups or bulk.
//
// Offers carry both amounts, worked out by staff from these rates: the PayPal
// amount and the store-credit amount (sell_submissions.credit_offer_cents,
// migration 20261102120000). Offers sent before that keep PayPal + 20%.

/** Highest share of TCG low paid by PayPal Goods & Services for singles shipped to us. */
export const SINGLES_PAYPAL_MAX_PERCENT = 70;

/** Share of TCG low paid in store credit, for singles worth at least CREDIT_MIN_CARD_CENTS. */
export const SINGLES_CREDIT_PERCENT = 80;

/** Store credit at SINGLES_CREDIT_PERCENT applies to singles worth at least this (TCG low). */
export const CREDIT_MIN_CARD_CENTS = 2000;

/** How soon a seller gets an offer after sending the form. */
export const OFFER_REPLY_HOURS = 24;

const creditMin = `$${CREDIT_MIN_CARD_CENTS / 100}`;

/** "up to 70% of TCG low by PayPal, or 80% in store credit on singles worth $20+" */
export const PAYOUT_SUMMARY = `up to ${SINGLES_PAYPAL_MAX_PERCENT}% of TCG low by PayPal, or ${SINGLES_CREDIT_PERCENT}% in store credit on singles worth ${creditMin}+`;

/** "80% of TCG low on singles worth $20+ shipped to us" — read as "store credit: …". */
export const CREDIT_SUMMARY = `${SINGLES_CREDIT_PERCENT}% of TCG low on singles worth ${creditMin}+ shipped to us`;

/** "Offer within 24 hours" */
export const OFFER_PROMISE = `Offer within ${OFFER_REPLY_HOURS} hours`;

/** "$20" — the store-credit card minimum, for sentences. */
export const CREDIT_MIN_LABEL = creditMin;
