// The Trade Center (storefront "Trade Cards", admin "Trades"): customers
// trade their Magic cards toward cards from our inventory, online. This
// module is what a trade is, its statuses, the wording customers see, and
// the arithmetic, shared by the pages and the server (api/trade-center.ts,
// api/admin/trade-center.ts, api/_lib/tradeCenter*.ts) so both always agree.
// How a trade runs end to end, and the database side, is explained in
// supabase/migrations/20261025120000_trade_center.sql.
//
// Pure module: no React, browser, Node or Supabase imports. Money is whole cents.

export const TRADE_CENTER_PATH = "/trade-cards";
export const MY_TRADES_PATH = "/account/trades";
export const TRADE_CENTER_API = "/api/trade-center";
export const ADMIN_TRADE_CENTER_API = "/api/admin/trade-center";

export function tradeLabel(tradeNumber: number): string {
  return `TR-${tradeNumber}`;
}

export function myTradePath(tradeId: string): string {
  return `${MY_TRADES_PATH}/${tradeId}`;
}

/** Input limits, checked in the browser for a friendly message and again by the server. */
export const TRADE_LIMITS = {
  maxQuantity: 99,
  maxCardNote: 500,
  maxTradeNote: 2000,
  maxMessage: 4000,
  maxEstimateCents: 10_000_000,
  /** Lines in one pasted list or CSV file. */
  maxImportLines: 200,
} as const;

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const TRADE_STATUSES = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_shipment",
  "in_transit",
  "received",
  "under_inspection",
  "awaiting_final_approval",
  "awaiting_payment",
  "approved_for_fulfillment",
  "completed",
  "rejected",
  "canceled",
  "expired",
  "return_pending",
  "returned",
] as const;

export type TradeStatus = (typeof TRADE_STATUSES)[number];

export function isTradeStatus(value: unknown): value is TradeStatus {
  return typeof value === "string" && (TRADE_STATUSES as readonly string[]).includes(value);
}

/** As customers read them (My Trades, emails). */
export const TRADE_STATUS_LABELS: Record<TradeStatus, string> = {
  awaiting_trade_list: "Waiting for your cards",
  pending_review: "Pending review",
  revision_requested: "Changes requested",
  awaiting_shipment: "Approved: ship your cards",
  in_transit: "On its way to us",
  received: "Received",
  under_inspection: "Inspecting your cards",
  awaiting_final_approval: "Final offer ready",
  awaiting_payment: "Waiting for payment",
  approved_for_fulfillment: "Complete: packing your order",
  completed: "Complete",
  rejected: "Not accepted",
  canceled: "Canceled",
  expired: "Expired",
  return_pending: "Returning your cards",
  returned: "Cards returned",
};

/** As staff read them (admin Trades). */
export const TRADE_STATUS_ADMIN_LABELS: Record<TradeStatus, string> = {
  awaiting_trade_list: "Building list",
  pending_review: "To review",
  revision_requested: "Changes requested",
  awaiting_shipment: "Awaiting package",
  in_transit: "In transit",
  received: "Received",
  under_inspection: "Inspecting",
  awaiting_final_approval: "Final offer sent",
  awaiting_payment: "Awaiting payment",
  approved_for_fulfillment: "To fulfill",
  completed: "Completed",
  rejected: "Rejected",
  canceled: "Canceled",
  expired: "Expired",
  return_pending: "Return to mail",
  returned: "Returned",
};

/** What happens next, in the customer's words, for each status. */
export const TRADE_STATUS_NEXT: Record<TradeStatus, string> = {
  awaiting_trade_list: "Add the cards you're trading in and send your list before the hold on our cards runs out.",
  pending_review: "We're reviewing your cards. We'll email you as soon as we've decided.",
  revision_requested: "We asked for a change. Update your list and send it again before the hold runs out.",
  awaiting_shipment: "Mail your cards and add the tracking number here by the ship-by date.",
  in_transit: "Your package is on its way. We'll email you when it arrives.",
  received: "Your package arrived. We'll inspect your cards next.",
  under_inspection: "We're inspecting your cards. We'll email your final offer when we're done.",
  awaiting_final_approval: "Your final offer is ready. Accept it, ask for an adjustment, or decline it.",
  awaiting_payment: "Pay the difference by card to finish your trade.",
  approved_for_fulfillment: "Your trade is done. We're packing your new cards.",
  completed: "Your new cards have shipped.",
  rejected: "We couldn't accept this trade. Our cards were released.",
  canceled: "This trade was canceled. Our cards were released.",
  expired: "This trade expired before it was finished. Our cards were released.",
  return_pending: "We're mailing your cards back to you.",
  returned: "Your cards were mailed back to you.",
};

/** Closed for good: nothing more happens. */
export const CLOSED_TRADE_STATUSES: ReadonlySet<TradeStatus> = new Set([
  "completed",
  "rejected",
  "canceled",
  "expired",
  "returned",
]);

export function isOpenTrade(status: TradeStatus): boolean {
  return !CLOSED_TRADE_STATUSES.has(status);
}

/** The customer can change their cards and ours. */
export const CUSTOMER_EDITABLE_STATUSES: readonly TradeStatus[] = ["awaiting_trade_list", "revision_requested"];

/** The customer can cancel: nothing has been mailed to us yet. */
export const CUSTOMER_CANCELABLE_STATUSES: readonly TradeStatus[] = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_shipment",
];

/** Staff can change which of our cards are on the trade (before the final offer). */
export const STAFF_WANTED_STATUSES: readonly TradeStatus[] = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_shipment",
  "in_transit",
  "received",
  "under_inspection",
];

/** Staff can reject outright: before shipping it closes; after, the cards go back. */
export const STAFF_REJECTABLE_STATUSES: readonly TradeStatus[] = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_shipment",
  "in_transit",
  "received",
  "under_inspection",
  "awaiting_final_approval",
  "awaiting_payment",
];

/** Nothing has reached us, so rejecting closes the trade instead of returning cards. */
export const PRE_SHIPMENT_STATUSES: readonly TradeStatus[] = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_shipment",
];

/** The progress bar on a trade. */
export const TRADE_STEPS = [
  { key: "list", label: "Your cards" },
  { key: "review", label: "Review" },
  { key: "ship", label: "Ship" },
  { key: "inspect", label: "Inspection" },
  { key: "offer", label: "Final offer" },
  { key: "done", label: "Done" },
] as const;

/** Which TRADE_STEPS step a status is on; -1 for a trade that stopped. */
export function tradeStepIndex(status: TradeStatus): number {
  switch (status) {
    case "awaiting_trade_list":
    case "revision_requested":
      return 0;
    case "pending_review":
      return 1;
    case "awaiting_shipment":
    case "in_transit":
      return 2;
    case "received":
    case "under_inspection":
      return 3;
    case "awaiting_final_approval":
    case "awaiting_payment":
      return 4;
    case "approved_for_fulfillment":
    case "completed":
      return 5;
    default:
      return -1;
  }
}

/** History entries customers see on their trade, worded for them. Others are staff-only. */
export const CUSTOMER_TIMELINE_LABELS: Readonly<Record<string, string>> = {
  started: "Trade started; our cards are on hold",
  wanted_changed: "Our cards on the trade changed",
  submitted: "You sent your list",
  resubmitted: "You sent your changes",
  revision_requested: "We asked for a change",
  approved: "Preliminarily approved",
  tracking_added: "You added a tracking number",
  received: "We received your package",
  final_offer_sent: "Your final offer is ready",
  adjustment_requested: "You asked for an adjustment",
  final_accepted: "You accepted the final offer",
  paid: "Payment received",
  finalized: "Trade complete; your order is being packed",
  completed: "Your new cards shipped",
  canceled: "Trade canceled",
  rejected: "Trade not accepted",
  expired: "Trade expired",
  return_pending: "We're returning your cards",
  returned: "Your cards were mailed back",
  hold_extended: "We gave you more time",
};

// ---------------------------------------------------------------------------
// Terms (trade_settings) as the storefront sees them
// ---------------------------------------------------------------------------

export type CardConditionCode = "NM" | "LP" | "MP" | "HP" | "DMG";
export const CARD_CONDITIONS: readonly CardConditionCode[] = ["NM", "LP", "MP", "HP", "DMG"];
export const CONDITION_NAMES: Record<CardConditionCode, string> = {
  NM: "Near Mint",
  LP: "Lightly Played",
  MP: "Moderately Played",
  HP: "Heavily Played",
  DMG: "Damaged",
};

export function isConditionCode(value: unknown): value is CardConditionCode {
  return typeof value === "string" && (CARD_CONDITIONS as readonly string[]).includes(value);
}

/** Finishes the reference price exists for (Scryfall's usd, usd_foil and usd_etched). */
export const TRADE_FINISHES = ["nonfoil", "foil", "etched"] as const;
export type TradeFinish = (typeof TRADE_FINISHES)[number];

export function isTradeFinish(value: unknown): value is TradeFinish {
  return typeof value === "string" && (TRADE_FINISHES as readonly string[]).includes(value);
}

export const FINISH_NAMES: Record<string, string> = { nonfoil: "Non-foil", foil: "Foil", etched: "Etched foil" };

export type ConditionPercents = Record<CardConditionCode, number>;

export interface TradeTerms {
  enabled: boolean;
  paused: boolean;
  pauseMessage: string;
  creditRatePercent: number;
  minCardValueCents: number;
  conditionPercents: ConditionPercents;
  reservationHours: number;
  revisionHours: number;
  shipBusinessDays: number;
  shipGraceHours: number;
  paymentDueDays: number;
  maxActiveTrades: number;
  maxWantedLines: number;
  maxOfferedLines: number;
  minTradeValueCents: number;
  maxTradeValueCents: number | null;
  processingFeeCents: number;
  cashPayoutEnabled: boolean;
  shippingPaidBy: "customer" | "store";
  packingInstructions: string;
  returnPolicy: string;
  excludedSetCodes: string[];
  excludedCardNames: string[];
  overstockThreshold: number;
  /** Staff have set the address customers mail their cards to. */
  hasShipToAddress: boolean;
}

/** Trading is open to new trades. */
export function tradingOpen(terms: Pick<TradeTerms, "enabled" | "paused"> | null | undefined): boolean {
  return Boolean(terms?.enabled && !terms.paused);
}

// ---------------------------------------------------------------------------
// Valuing the customer's cards
// ---------------------------------------------------------------------------

export function conditionPercent(percents: Partial<ConditionPercents> | null | undefined, condition: string): number {
  const value = percents?.[condition as CardConditionCode];
  return typeof value === "number" && value >= 0 && value <= 100 ? value : 100;
}

/** What one card is estimated at: its reference price for the condition, to the cent. */
export function estimatedUnitCents(referenceCents: number | null, percent: number): number | null {
  if (referenceCents == null) return null;
  return Math.round((referenceCents * percent) / 100);
}

export type TradeEligibility =
  | "eligible"
  | "needs_review"
  | "below_minimum"
  | "excluded_set"
  | "excluded_card"
  | "overstocked";

/** A card that can't be sent with any of these: it has to come off the list. */
export const BLOCKING_ELIGIBILITY: ReadonlySet<TradeEligibility> = new Set([
  "below_minimum",
  "excluded_set",
  "excluded_card",
  "overstocked",
]);

export function eligibilityFor(
  card: { estimatedUnitCents: number | null; setCode: string | null; cardName: string; stockOnHand?: number | null },
  terms: Pick<TradeTerms, "minCardValueCents" | "excludedSetCodes" | "excludedCardNames" | "overstockThreshold">,
): TradeEligibility {
  const setCode = (card.setCode ?? "").trim().toLowerCase();
  if (setCode && terms.excludedSetCodes.some((code) => code.trim().toLowerCase() === setCode)) return "excluded_set";
  const name = card.cardName.trim().toLowerCase();
  if (terms.excludedCardNames.some((n) => n.trim().toLowerCase() === name)) return "excluded_card";
  if (terms.overstockThreshold > 0 && (card.stockOnHand ?? 0) >= terms.overstockThreshold) return "overstocked";
  if (card.estimatedUnitCents == null) return "needs_review";
  if (card.estimatedUnitCents < terms.minCardValueCents) return "below_minimum";
  return "eligible";
}

/** Why a card can or can't be offered, in the customer's words. */
export function eligibilityMessage(eligibility: TradeEligibility, minCardValueCents: number): string {
  switch (eligibility) {
    case "eligible":
      return "Eligible";
    case "needs_review":
      return "No current market price. We'll value it by hand.";
    case "below_minimum":
      return `Under our ${formatUsd(minCardValueCents)} minimum per card, in this condition`;
    case "excluded_set":
      return "We're not taking cards from this set right now";
    case "excluded_card":
      return "We're not taking this card right now";
    case "overstocked":
      return "We have plenty of this printing right now";
  }
}

/** Trade credit for cards worth `valueCents`: the rate, to the cent, less any fee. */
export function tradeCreditCents(valueCents: number, ratePercent: number, feeCents = 0): number {
  return Math.max(Math.round((valueCents * ratePercent) / 100) - feeCents, 0);
}

/** About the card value it takes to earn `creditCents` of trade credit. */
export function valueForCreditCents(creditCents: number, ratePercent: number, feeCents = 0): number {
  if (creditCents <= 0 || ratePercent <= 0) return 0;
  return Math.ceil(((creditCents + feeCents) * 100) / ratePercent);
}

/** Our cards ship tracked, free from $75 of cards: the same as checkout. */
export const TRADE_TRACKED_SHIPPING_CENTS = 550;
export const TRADE_FREE_SHIPPING_FROM_CENTS = 7500;

export function tradeShippingCents(wantedCents: number): number {
  if (wantedCents <= 0) return 0;
  return wantedCents >= TRADE_FREE_SHIPPING_FROM_CENTS ? 0 : TRADE_TRACKED_SHIPPING_CENTS;
}

export interface TradeComparison {
  /** Our cards, at their trade prices. */
  wantedCents: number;
  /** Shipping our cards to the customer. */
  shippingCents: number;
  /** Their cards. */
  offeredValueCents: number;
  creditCents: number;
  /** Still to pay (by card, at the end) when the credit falls short; 0 when covered. */
  remainingCents: number;
  /** Credit beyond our cards and shipping; kept as store credit. 0 when there's none. */
  excessCents: number;
  /** About how much more card value would cover everything; 0 when covered. */
  moreValueNeededCents: number;
}

export function tradeComparison(input: {
  wantedCents: number;
  offeredValueCents: number;
  ratePercent: number;
  feeCents?: number;
  /** Defaults to what checkout would charge for `wantedCents`. */
  shippingCents?: number;
}): TradeComparison {
  const fee = input.feeCents ?? 0;
  const shippingCents = input.shippingCents ?? tradeShippingCents(input.wantedCents);
  const creditCents = tradeCreditCents(input.offeredValueCents, input.ratePercent, fee);
  const due = input.wantedCents + shippingCents;
  return {
    wantedCents: input.wantedCents,
    shippingCents,
    offeredValueCents: input.offeredValueCents,
    creditCents,
    remainingCents: Math.max(due - creditCents, 0),
    excessCents: Math.max(creditCents - due, 0),
    moreValueNeededCents: Math.max(valueForCreditCents(due, input.ratePercent, fee) - input.offeredValueCents, 0),
  };
}

/** Cash for credit beyond the order, when staff offer it: the same card value at the cash rate. */
export function cashForExcessCents(excessCreditCents: number, creditRatePercent: number, cashRatePercent: number): number {
  if (excessCreditCents <= 0 || creditRatePercent <= 0) return 0;
  return Math.round((excessCreditCents * cashRatePercent) / creditRatePercent);
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

const STORE_TIME_ZONE = "America/Chicago";
const DAY_MS = 24 * 60 * 60 * 1000;

function chicagoParts(ms: number): { year: number; month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday") };
}

/** The UTC instant of a wall-clock time in St. Louis on a given date. */
function chicagoInstant(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  // St. Louis is 5 or 6 hours behind UTC; correct the guess by that offset.
  return guess - (wall - guess);
}

/** 11:59:59 pm in St. Louis on the day `ms` falls on there. */
export function endOfStoreDay(ms: number): number {
  const { year, month, day } = chicagoParts(ms);
  return chicagoInstant(year, month, day, 23, 59, 59);
}

/**
 * The end (11:59:59 pm in St. Louis) of the `days`th business day after
 * `fromMs`. Saturdays and Sundays don't count; holidays aren't skipped.
 */
export function addBusinessDays(fromMs: number, days: number): number {
  let t = fromMs;
  let counted = 0;
  while (counted < days) {
    t += DAY_MS;
    const { weekday } = chicagoParts(t);
    if (weekday !== "Sat" && weekday !== "Sun") counted += 1;
  }
  return endOfStoreDay(t);
}

/** "2 days", "5 hours", "under an hour": time left until a deadline. */
export function timeLeft(untilMs: number, nowMs: number): string {
  const ms = untilMs - nowMs;
  if (ms <= 0) return "no time";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;
  return "under an hour";
}

/** A deadline as customers read it: "Tue, Oct 27, 11:59 PM CT". */
export function formatDeadline(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", {
    timeZone: STORE_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} CT`;
}

// ---------------------------------------------------------------------------
// Shipping their cards in
// ---------------------------------------------------------------------------

export const TRADE_CARRIERS = ["USPS", "UPS", "FedEx", "Other"] as const;
export type TradeCarrier = (typeof TRADE_CARRIERS)[number];

export function isTradeCarrier(value: unknown): value is TradeCarrier {
  return typeof value === "string" && (TRADE_CARRIERS as readonly string[]).includes(value);
}

/** A tracking number as carriers print it: letters and digits; spaces and dashes are dropped. */
export function cleanTrackingNumber(input: string): string | null {
  const compact = input.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{8,40}$/.test(compact) ? compact : null;
}

// ---------------------------------------------------------------------------
// What the browser sends
// ---------------------------------------------------------------------------

/** One of our cards: an inventory line and how many. */
export interface TradeWantedInput {
  inventoryItemId: string;
  quantity: number;
}

/** One of the customer's cards. The server looks the printing up and prices it. */
export interface TradeOfferInput {
  /** A card already on the list (keeps staff's review when unchanged). */
  id?: string;
  scryfallId: string;
  finish: TradeFinish;
  condition: CardConditionCode;
  quantity: number;
  customerEstimateCents?: number | null;
  note?: string | null;
}

export interface TradeShipToInput {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
}

// ---------------------------------------------------------------------------
// What the pages are sent
// ---------------------------------------------------------------------------

/** One of our cards on a trade. */
export interface TradeWantedItem {
  id: string;
  inventoryItemId: string | null;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  condition: string;
  finish: string;
  variantType: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  /** reserved: held for the trade; released: let go; fulfilled: on the trade's order. */
  status: "reserved" | "released" | "fulfilled";
}

/** One of the customer's cards on a trade, as the customer sees it. */
export interface TradeOfferCard {
  id: string;
  scryfallId: string | null;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  finish: string;
  imageUrl: string | null;
  quantity: number;
  reportedCondition: CardConditionCode;
  customerEstimateCents: number | null;
  customerNote: string | null;
  referencePriceCents: number | null;
  referenceCheckedAt: string | null;
  conditionPercent: number;
  estimatedUnitCents: number | null;
  eligibility: TradeEligibility;
  reviewStatus: "pending" | "approved" | "rejected";
  approvedQuantity: number | null;
  approvedUnitCents: number | null;
  /** From staff, for the customer. */
  reviewNote: string | null;
  receivedQuantity: number | null;
  verifiedCondition: CardConditionCode | null;
  finalQuantity: number | null;
  finalUnitCents: number | null;
  flags: string[];
  /** From staff, for the customer. */
  inspectionNote: string | null;
  inspected: boolean;
  disposition: "pending" | "accepted" | "rejected" | "returned" | "imported";
}

export interface TradeMessage {
  id: string;
  authorType: "customer" | "staff" | "system";
  /** Staff only: who wrote it. Customers see "Geega Games". */
  authorLabel: string | null;
  body: string;
  createdAt: string;
  /** False: a staff-only note (never sent to customers). */
  visibleToCustomer: boolean;
}

export interface TradeTimelineEntry {
  event: string;
  label: string;
  createdAt: string;
}

export interface TradeAddress {
  name: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
}

/** A trade, as its customer sees it: nothing staff-only. */
export interface CustomerTrade {
  id: string;
  tradeNumber: number;
  status: TradeStatus;
  createdAt: string;
  updatedAt: string;
  creditRatePercent: number;
  minCardValueCents: number;
  conditionPercents: ConditionPercents;
  processingFeeCents: number;
  wantedTotalCents: number;
  estimatedValueCents: number;
  approvedValueCents: number | null;
  finalValueCents: number | null;
  finalCreditCents: number | null;
  shippingCents: number | null;
  amountDueCents: number | null;
  excessCents: number | null;
  excessHandling: "store_credit" | "cash";
  cashPayoutCents: number | null;
  holdExpiresAt: string | null;
  shipBy: string | null;
  paymentDueAt: string | null;
  approvalConditions: string | null;
  inboundCarrier: string | null;
  inboundTracking: string | null;
  returnCarrier: string | null;
  returnTracking: string | null;
  orderId: string | null;
  creditIssuedCents: number | null;
  customerNote: string | null;
  closeReason: string | null;
  /** Where our cards ship (once they accept the final offer). */
  shipTo: TradeAddress | null;
  wanted: TradeWantedItem[];
  offered: TradeOfferCard[];
  messages: TradeMessage[];
  timeline: TradeTimelineEntry[];
  /** Where to mail their cards: only once the trade is approved. */
  mailTo: TradeAddress | null;
  packingInstructions: string | null;
  returnPolicy: string;
}

/** A row in My Trades. */
export interface CustomerTradeSummary {
  id: string;
  tradeNumber: number;
  status: TradeStatus;
  createdAt: string;
  updatedAt: string;
  wantedTotalCents: number;
  wantedCount: number;
  offeredCount: number;
  holdExpiresAt: string | null;
  shipBy: string | null;
  paymentDueAt: string | null;
}

/** One of the customer's cards, as staff see it. */
export interface StaffTradeOfferCard extends TradeOfferCard {
  internalNote: string | null;
  inspectionInternalNote: string | null;
  authenticity: "unchecked" | "authentic" | "counterfeit" | "unsure";
  inspectedAt: string | null;
  stockOnHand: number | null;
  importedInventoryItemId: string | null;
}

export interface StaffTradeEvent {
  id: string;
  actorType: "customer" | "staff" | "system";
  actorLabel: string | null;
  event: string;
  fromStatus: string | null;
  toStatus: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** A trade, as staff see it: everything. */
export interface StaffTrade extends Omit<CustomerTrade, "offered" | "timeline"> {
  userId: string;
  customerName: string | null;
  customerEmail: string | null;
  offered: StaffTradeOfferCard[];
  events: StaffTradeEvent[];
  submittedAt: string | null;
  approvedAt: string | null;
  receivedAt: string | null;
  finalOfferAt: string | null;
  acceptedAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  inboundShippedAt: string | null;
  returnedAt: string | null;
  cashPaidAt: string | null;
  paymentReference: string | null;
}

/** A row in admin Trades. */
export interface StaffTradeSummary {
  id: string;
  tradeNumber: number;
  status: TradeStatus;
  customerName: string | null;
  customerEmail: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  wantedTotalCents: number;
  estimatedValueCents: number;
  approvedValueCents: number | null;
  finalValueCents: number | null;
  holdExpiresAt: string | null;
  shipBy: string | null;
  inboundTracking: string | null;
  inboundShippedAt: string | null;
}

/** trade_settings as staff edit it (admin Trades, Settings). */
export interface TradeSettings {
  enabled: boolean;
  paused: boolean;
  pauseMessage: string;
  creditRatePercent: number;
  minCardValueCents: number;
  conditionPercents: ConditionPercents;
  reservationHours: number;
  revisionHours: number;
  shipBusinessDays: number;
  shipGraceHours: number;
  transitAlertDays: number;
  paymentDueDays: number;
  maxActiveTrades: number;
  maxWantedLines: number;
  maxOfferedLines: number;
  minTradeValueCents: number;
  maxTradeValueCents: number | null;
  maxExpiredTrades30d: number;
  processingFeeCents: number;
  cashPayoutEnabled: boolean;
  cashRatePercent: number;
  overstockThreshold: number;
  excludedSetCodes: string[];
  excludedCardNames: string[];
  notifyCustomer: boolean;
  notifyStaff: boolean;
  shippingPaidBy: "customer" | "store";
  shipTo: TradeAddress | null;
  packingInstructions: string;
  returnPolicy: string;
  updatedAt: string | null;
}

/** The numeric settings and the ranges the database allows for each. */
export const TRADE_SETTING_RANGES = {
  creditRatePercent: [1, 100],
  minCardValueCents: [0, 10_000_000],
  conditionPercent: [0, 100],
  reservationHours: [1, 168],
  revisionHours: [1, 336],
  shipBusinessDays: [1, 30],
  shipGraceHours: [0, 336],
  transitAlertDays: [1, 90],
  paymentDueDays: [1, 60],
  maxActiveTrades: [1, 20],
  maxWantedLines: [1, 200],
  maxOfferedLines: [1, 500],
  minTradeValueCents: [0, 100_000_000],
  maxTradeValueCents: [1, 100_000_000],
  maxExpiredTrades30d: [1, 50],
  processingFeeCents: [0, 1_000_000],
  cashRatePercent: [1, 100],
  overstockThreshold: [0, 1000],
} as const;

// ---------------------------------------------------------------------------
// Formatting (here so the emails and the pages say the same thing)
// ---------------------------------------------------------------------------

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "Sheoldred, the Apocalypse (DMU #107, foil)". */
export function cardLine(card: { cardName: string; setCode: string | null; collectorNumber: string | null; finish: string }): string {
  const where = [card.setCode?.toUpperCase(), card.collectorNumber ? `#${card.collectorNumber}` : null].filter(Boolean).join(" ");
  const finish = card.finish !== "nonfoil" ? (FINISH_NAMES[card.finish] ?? card.finish).toLowerCase() : null;
  const extra = [where, finish].filter(Boolean).join(", ");
  return extra ? `${card.cardName} (${extra})` : card.cardName;
}
