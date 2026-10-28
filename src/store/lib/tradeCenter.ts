// The Trade Center (storefront "Trade Cards", admin "Trades"): customers
// trade their Magic cards toward cards from our inventory, online. This
// module is what a trade is, its statuses, the wording customers see, and
// the arithmetic, shared by the pages and the server (api/trade-center.ts,
// api/admin/trade-center.ts, api/_lib/tradeCenter*.ts) so both always agree.
// How a trade runs end to end, and the database side, is explained in
// supabase/migrations/20261025200000_trade_center.sql; deadlines are in
// tradeDeadlines.ts, the deposit and reliability in tradeRules.ts, tracking
// numbers and carrier scans in tradeTracking.ts, the trade minimum and
// shipping our cards in tradeShipping.ts.
//
// Pure module: no React, browser, Node or Supabase imports. Money is whole cents.

import { formatStoreDeadline } from "./tradeDeadlines.js";
import type { DepositOverride, DepositReason, CustomerRecord, Privileges } from "./tradeRules.js";
import type { TrackingScan } from "./tradeTracking.js";
import { DEFAULT_SHIPPING_TERMS, tradeShippingCents, type ShippingTerms } from "./tradeShipping.js";

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
  /** Proof of shipping: files, and each one's size. */
  maxDisputeFiles: 5,
  maxDisputeFileBytes: 10 * 1024 * 1024,
} as const;

/** File types accepted as proof of shipping (the bucket enforces the same). */
export const DISPUTE_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const TRADE_STATUSES = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_confirmation",
  "awaiting_deposit",
  "awaiting_shipment",
  "tracking_submitted",
  "in_transit",
  "received",
  "under_inspection",
  "awaiting_final_approval",
  "awaiting_payment",
  "approved_for_fulfillment",
  "completed",
  "rejected",
  "offer_expired",
  "canceled",
  "expired",
  "canceled_after_shipment",
  "declined_after_inspection",
  "canceled_by_store",
] as const;

export type TradeStatus = (typeof TRADE_STATUSES)[number];

export function isTradeStatus(value: unknown): value is TradeStatus {
  return typeof value === "string" && (TRADE_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// How the cards change hands: by mail, or in person (local pickup)
// ---------------------------------------------------------------------------

export const TRADE_HANDOFF_METHODS = ["ship", "local"] as const;
/** ship: the customer mails their cards and we ship ours. local: we meet in person. */
export type TradeHandoffMethod = (typeof TRADE_HANDOFF_METHODS)[number];

export function isHandoffMethod(value: unknown): value is TradeHandoffMethod {
  return value === "ship" || value === "local";
}

export const HANDOFF_LABELS: Record<TradeHandoffMethod, string> = {
  ship: "Ship",
  local: "Local pickup",
};

/** As customers read them (My Trades, emails). */
export const TRADE_STATUS_LABELS: Record<TradeStatus, string> = {
  awaiting_trade_list: "Draft: add your cards",
  pending_review: "Pending admin review",
  revision_requested: "Changes requested",
  awaiting_confirmation: "Awaiting your confirmation",
  awaiting_deposit: "Awaiting deposit payment",
  awaiting_shipment: "Reserved: awaiting shipment",
  tracking_submitted: "Tracking submitted: awaiting carrier scan",
  in_transit: "Shipped: in transit",
  received: "Delivered: awaiting inspection",
  under_inspection: "Inspection in progress",
  awaiting_final_approval: "Final offer: awaiting your response",
  awaiting_payment: "Accepted: payment due",
  approved_for_fulfillment: "Final trade approved",
  completed: "Trade completed",
  rejected: "Not accepted",
  offer_expired: "Offer expired",
  canceled: "Canceled before shipment",
  expired: "Reservation expired",
  canceled_after_shipment: "Canceled after shipment: no penalty",
  declined_after_inspection: "Declined after inspection: no penalty",
  canceled_by_store: "Canceled by Geega Games",
};

/** As staff read them (admin Trades). */
export const TRADE_STATUS_ADMIN_LABELS: Record<TradeStatus, string> = {
  awaiting_trade_list: "Draft",
  pending_review: "To review",
  revision_requested: "Changes requested",
  awaiting_confirmation: "Awaiting confirmation",
  awaiting_deposit: "Awaiting deposit",
  awaiting_shipment: "Reserved: awaiting shipment",
  tracking_submitted: "Awaiting carrier scan",
  in_transit: "Shipped: in transit",
  received: "Delivered: to inspect",
  under_inspection: "Inspecting",
  awaiting_final_approval: "Final offer sent",
  awaiting_payment: "Awaiting payment",
  approved_for_fulfillment: "Final trade approved",
  completed: "Completed",
  rejected: "Rejected",
  offer_expired: "Offer expired",
  canceled: "Canceled before shipment",
  expired: "Reservation expired",
  canceled_after_shipment: "Canceled after shipment",
  declined_after_inspection: "Declined after inspection",
  canceled_by_store: "Canceled by us",
};

/** What happens next, in the customer's words, for each status. */
export const TRADE_STATUS_NEXT: Record<TradeStatus, string> = {
  awaiting_trade_list:
    "Add the cards you're trading in and send your trade for review. Our cards aren't reserved yet: they stay on sale until your trade is confirmed.",
  pending_review: "We're reviewing your trade and will email you as soon as we've decided. Our cards aren't reserved yet.",
  revision_requested: "We need a change before we can approve your trade. Update it and send it again.",
  awaiting_confirmation: "Your trade is approved. Confirm it before the deadline to reserve our cards.",
  awaiting_deposit: "Pay the refundable deposit to reserve our cards. Nothing is reserved until it goes through.",
  awaiting_shipment: "Our cards are reserved for you. Ship your cards and add the tracking number before the deadline.",
  tracking_submitted: "We have your tracking number. Your shipment counts once the carrier scans the package.",
  in_transit: "The carrier has your package. We'll email you when it arrives.",
  received: "Your package arrived. We'll inspect your cards next.",
  under_inspection: "We're inspecting your cards and will email your final offer when we're done.",
  awaiting_final_approval: "Your final offer is ready. Accept it, ask for an adjustment, or decline it with no penalty.",
  awaiting_payment: "Pay what's left by card (any of our cards your credit doesn't cover, and shipping them to you) to finish your trade.",
  approved_for_fulfillment: "Your trade is done. We're packing your new cards.",
  completed: "Your new cards have shipped.",
  rejected: "We couldn't accept this trade.",
  offer_expired: "This trade wasn't sent or confirmed in time, so it closed. Nothing was reserved or charged.",
  canceled: "This trade was canceled before shipping. Our cards were released.",
  expired: "Your cards weren't shipped by the deadline, so our cards were released.",
  canceled_after_shipment: "You canceled after shipping, with no penalty. We'll mail your cards back.",
  declined_after_inspection: "You declined the final offer, with no penalty. We'll mail your cards back.",
  canceled_by_store: "We canceled this trade. Any deposit is refunded in full.",
};

/** A local pickup trade, where it reads differently from a shipped one (customers). */
const LOCAL_STATUS_LABELS: Partial<Record<TradeStatus, string>> = {
  awaiting_trade_list: "Draft: send it for review",
  awaiting_shipment: "Reserved: let's meet up",
  completed: "Trade completed",
  canceled: "Canceled",
  expired: "Hold ended",
};

const LOCAL_STATUS_NEXT: Partial<Record<TradeStatus, string>> = {
  awaiting_trade_list:
    "Pick our cards and send your trade for review. You don't need to list your cards: bring them when we meet. Our cards aren't reserved yet.",
  pending_review: "We're reviewing your trade and will email you as soon as we've decided. Our cards aren't reserved yet.",
  revision_requested: "We need a change before we can approve your trade. Update it and send it again.",
  awaiting_confirmation: "Your trade is approved. Confirm it before the deadline to reserve our cards until we meet.",
  awaiting_shipment:
    "Our cards are reserved for you. We'll message you to set a time and place to meet: bring the cards you're trading in, and we'll settle the trade there.",
  completed: "We met up and traded. Thanks for trading with us!",
  canceled: "This trade was canceled. Our cards went back on sale.",
  expired: "We didn't meet before the hold ended, so our cards went back on sale. Message us, or start a new trade.",
};

/** As staff read them, where a local pickup trade differs. */
const LOCAL_STATUS_ADMIN_LABELS: Partial<Record<TradeStatus, string>> = {
  awaiting_shipment: "Reserved: meet up",
  completed: "Completed (in person)",
  canceled: "Canceled",
  expired: "Hold ended",
};

/** A status as customers read it, for this kind of trade. */
export function tradeStatusLabel(status: TradeStatus, method: TradeHandoffMethod = "ship"): string {
  return (method === "local" ? LOCAL_STATUS_LABELS[status] : undefined) ?? TRADE_STATUS_LABELS[status];
}

/** What happens next, in the customer's words, for this kind of trade. */
export function tradeStatusNext(status: TradeStatus, method: TradeHandoffMethod = "ship"): string {
  return (method === "local" ? LOCAL_STATUS_NEXT[status] : undefined) ?? TRADE_STATUS_NEXT[status];
}

/** A status as staff read it, for this kind of trade. */
export function tradeStatusAdminLabel(status: TradeStatus, method: TradeHandoffMethod = "ship"): string {
  return (method === "local" ? LOCAL_STATUS_ADMIN_LABELS[status] : undefined) ?? TRADE_STATUS_ADMIN_LABELS[status];
}

/** Closed for good: nothing more happens to the trade itself. */
export const CLOSED_TRADE_STATUSES: ReadonlySet<TradeStatus> = new Set([
  "completed",
  "rejected",
  "offer_expired",
  "canceled",
  "expired",
  "canceled_after_shipment",
  "declined_after_inspection",
  "canceled_by_store",
]);

export function isOpenTrade(status: TradeStatus): boolean {
  return !CLOSED_TRADE_STATUSES.has(status);
}

/** Our cards are held (inventory reservations) in these. */
export const RESERVED_STATUSES: readonly TradeStatus[] = [
  "awaiting_shipment",
  "tracking_submitted",
  "in_transit",
  "received",
  "under_inspection",
  "awaiting_final_approval",
  "awaiting_payment",
];

/** The customer can change their cards and ours. */
export const CUSTOMER_EDITABLE_STATUSES: readonly TradeStatus[] = ["awaiting_trade_list", "revision_requested"];

/** The customer can cancel: nothing has been mailed to us yet. Reserved ones put a paid deposit up for review. */
export const CUSTOMER_CANCELABLE_STATUSES: readonly TradeStatus[] = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_confirmation",
  "awaiting_deposit",
  "awaiting_shipment",
];

/** The customer can withdraw after the carrier accepted their package: no penalty, their cards come back. */
export const CUSTOMER_WITHDRAW_STATUSES: readonly TradeStatus[] = ["in_transit", "received", "under_inspection"];

/** Staff can change which of our cards are on the trade (not while the customer decides on an approval). */
export const STAFF_WANTED_STATUSES: readonly TradeStatus[] = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_shipment",
  "tracking_submitted",
  "in_transit",
  "received",
  "under_inspection",
];

/** Staff can reject: before the trade is confirmed (nothing held, nothing paid). */
export const STAFF_REJECTABLE_STATUSES: readonly TradeStatus[] = [
  "awaiting_trade_list",
  "pending_review",
  "revision_requested",
  "awaiting_confirmation",
  "awaiting_deposit",
];

/** Staff can cancel a confirmed trade (refunding any deposit, returning cards that reached us). */
export const STAFF_CANCELABLE_STATUSES: readonly TradeStatus[] = [
  "awaiting_shipment",
  "tracking_submitted",
  "in_transit",
  "received",
  "under_inspection",
  "awaiting_final_approval",
  "awaiting_payment",
];

/** The progress bar on a trade. */
export const TRADE_STEPS = [
  { key: "list", label: "Your cards" },
  { key: "review", label: "Review" },
  { key: "confirm", label: "Confirm" },
  { key: "ship", label: "Ship" },
  { key: "inspect", label: "Inspection" },
  { key: "offer", label: "Final offer" },
  { key: "done", label: "Done" },
] as const;

/** The progress bar on a local pickup trade: no shipping, no inspection by mail. */
export const LOCAL_TRADE_STEPS = [
  { key: "list", label: "Our cards" },
  { key: "review", label: "Review" },
  { key: "confirm", label: "Confirm" },
  { key: "meet", label: "Meet up" },
  { key: "done", label: "Done" },
] as const;

export function tradeStepsFor(method: TradeHandoffMethod): readonly { key: string; label: string }[] {
  return method === "local" ? LOCAL_TRADE_STEPS : TRADE_STEPS;
}

/** Which step of tradeStepsFor(method) a status is on; -1 for a trade that stopped. */
export function tradeStepIndexFor(status: TradeStatus, method: TradeHandoffMethod): number {
  if (method !== "local") return tradeStepIndex(status);
  switch (status) {
    case "awaiting_trade_list":
    case "revision_requested":
      return 0;
    case "pending_review":
      return 1;
    case "awaiting_confirmation":
    case "awaiting_deposit":
      return 2;
    case "awaiting_shipment":
      return 3;
    case "approved_for_fulfillment":
    case "completed":
      return 4;
    default:
      return -1;
  }
}

/** Which TRADE_STEPS step a status is on; -1 for a trade that stopped. */
export function tradeStepIndex(status: TradeStatus): number {
  switch (status) {
    case "awaiting_trade_list":
    case "revision_requested":
      return 0;
    case "pending_review":
      return 1;
    case "awaiting_confirmation":
    case "awaiting_deposit":
      return 2;
    case "awaiting_shipment":
    case "tracking_submitted":
    case "in_transit":
      return 3;
    case "received":
    case "under_inspection":
      return 4;
    case "awaiting_final_approval":
    case "awaiting_payment":
      return 5;
    case "approved_for_fulfillment":
    case "completed":
      return 6;
    default:
      return -1;
  }
}

/** History entries customers see on their trade, worded for them. Others are staff-only. */
export const CUSTOMER_TIMELINE_LABELS: Readonly<Record<string, string>> = {
  started: "Trade started",
  wanted_changed: "Our cards on the trade changed",
  submitted: "You sent your trade for review",
  resubmitted: "You sent your changes",
  revision_requested: "We asked for a change",
  cards_unavailable: "Some of our cards sold before you confirmed",
  approved: "Approved: waiting for your confirmation",
  deposit_requirement_changed: "The deposit for this trade changed",
  deposit_payment_started: "You agreed to the deposit terms",
  deposit_paid: "Deposit paid",
  reserved: "Our cards were reserved for you",
  reservation_conflict: "Our cards sold before your deposit went through",
  deadline_extended: "We gave you more time",
  tracking_added: "You added a tracking number",
  tracking_changed: "You changed the tracking number",
  shipment_verified: "The carrier accepted your package",
  dispute_opened: "You sent proof of shipping",
  dispute_accepted: "We accepted your proof of shipping",
  dispute_rejected: "We reviewed your proof of shipping",
  deposit_refund_pending: "Deposit refund started",
  deposit_refunded: "Deposit refunded",
  deposit_forfeiture_review: "Deposit under review",
  deposit_forfeited: "Deposit kept under the cancellation policy",
  delivered: "Your package was delivered",
  received: "We received your package",
  final_offer_sent: "Your final offer is ready",
  adjustment_requested: "You asked for an adjustment",
  final_accepted: "You accepted the final offer",
  paid: "Payment received",
  finalized: "Trade complete; your order is being packed",
  completed: "Your new cards shipped",
  canceled: "Trade canceled",
  rejected: "Trade not accepted",
  offer_expired: "Trade closed: not sent or confirmed in time",
  expired: "Reservation expired",
  reinstated: "We reinstated your reservation",
  canceled_after_shipment: "You canceled after shipping",
  declined_after_inspection: "You declined the final offer",
  canceled_by_store: "We canceled the trade",
  returned: "Your cards were mailed back",
  handoff_changed: "You changed how you'll trade",
  meetup_set: "We updated where and when to meet",
  met_up: "We met up and traded",
};

/** History entries that read differently on a local pickup trade. */
const LOCAL_TIMELINE_LABELS: Readonly<Record<string, string>> = {
  submitted: "You sent your trade for review",
  approved: "Approved: waiting for your confirmation",
  reserved: "Our cards were reserved for you until we meet",
  deadline_extended: "We gave you more time to meet",
  finalized: "Trade complete",
  completed: "You picked up our cards",
  expired: "The hold on our cards ended",
  canceled: "Trade canceled",
};

/** A history entry as its customer reads it, or undefined for one they don't see. */
export function timelineLabel(event: string, method: TradeHandoffMethod = "ship"): string | undefined {
  if (method === "local" && LOCAL_TIMELINE_LABELS[event] !== undefined) return LOCAL_TIMELINE_LABELS[event];
  return CUSTOMER_TIMELINE_LABELS[event];
}

// ---------------------------------------------------------------------------
// The deposit
// ---------------------------------------------------------------------------

export const DEPOSIT_STATUSES = [
  "not_required",
  "payment_pending",
  "paid",
  "refund_pending",
  "refunded",
  "forfeiture_review",
  "forfeited",
  "refund_failed",
  "canceled",
] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export function isDepositStatus(value: unknown): value is DepositStatus {
  return typeof value === "string" && (DEPOSIT_STATUSES as readonly string[]).includes(value);
}

/** As customers read them. */
export const DEPOSIT_STATUS_LABELS: Record<DepositStatus, string> = {
  not_required: "No deposit",
  payment_pending: "Payment pending",
  paid: "Paid (refundable)",
  refund_pending: "Refund on its way",
  refunded: "Refunded in full",
  forfeiture_review: "Under review",
  forfeited: "Kept under the cancellation policy",
  refund_failed: "Refund delayed: we're on it",
  canceled: "Not collected",
};

/** As staff read them. */
export const DEPOSIT_STATUS_ADMIN_LABELS: Record<DepositStatus, string> = {
  not_required: "Not required",
  payment_pending: "Payment pending",
  paid: "Paid",
  refund_pending: "Refund pending",
  refunded: "Refunded",
  forfeiture_review: "Forfeiture review",
  forfeited: "Forfeited",
  refund_failed: "Refund failed",
  canceled: "Not collected",
};

/** Deposits staff need to act on. */
export const DEPOSIT_NEEDS_STAFF: ReadonlySet<DepositStatus> = new Set(["forfeiture_review", "refund_failed"]);

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
  /** A draft nobody sends closes after this many days. */
  draftDays: number;
  revisionHours: number;
  /** Qualifying hours to confirm an approved trade (Sundays don't count). */
  confirmationHours: number;
  /** Qualifying days to ship once reserved: new customers, and after the loyalty tiers. */
  shipDaysNew: number;
  shipDaysTier1: number;
  shipDaysTier2: number;
  loyaltyTier1Trades: number;
  loyaltyTier2Trades: number;
  scanGraceHours: number;
  /** Extra days that don't count toward a deadline ("YYYY-MM-DD"). */
  excludedDates: string[];
  paymentDueDays: number;
  disputeWindowDays: number;
  maxActiveTrades: number;
  maxWantedLines: number;
  maxOfferedLines: number;
  /** Our cards (retail value) must add up to this to start or send a trade. */
  minTradeValueCents: number;
  maxTradeValueCents: number | null;
  processingFeeCents: number;
  cashPayoutEnabled: boolean;
  shippingPaidBy: "customer" | "store";
  /** Shipping our cards to them: under the free-shipping threshold, and from it up (paid by card). */
  shipFeeCents: number;
  freeShipThresholdCents: number;
  freeShipFeeCents: number;
  packingInstructions: string;
  returnPolicy: string;
  excludedSetCodes: string[];
  excludedCardNames: string[];
  overstockThreshold: number;
  /** Staff have set the address customers mail their cards to. */
  hasShipToAddress: boolean;
  depositsEnabled: boolean;
  depositThresholdCents: number;
  depositBand1MaxCents: number;
  depositBand2MaxCents: number;
  depositBand3MaxCents: number;
  depositBand1Cents: number;
  depositBand2Cents: number;
  depositBand3Cents: number;
  depositBand4Cents: number;
  /** The deposit and cancellation terms customers agree to. */
  depositTerms: string;
  depositTermsVersion: number;
  /** Customers can choose local pickup: trade in person, no shipping. */
  localPickupEnabled: boolean;
  /** Where local pickup is offered ("the St. Louis area"). */
  localPickupArea: string;
  /** Qualifying days our cards are held for the meetup once a local trade is confirmed. */
  localMeetDays: number;
  /** How meetups work, for customers choosing local pickup. */
  localPickupDetails: string;
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
      return "No price found yet. We'll price it when we review your list.";
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

/**
 * What one of our cards counts for in a trade: its regular price, so a
 * deal's price before the discount (sale and member pricing don't apply).
 * The database does the same when the card is added (trade_regular_price).
 */
export function tradePriceCents(listing: { priceCents: number | null; originalPriceCents: number | null; isDeal: boolean | null }): number | null {
  if (listing.isDeal && listing.originalPriceCents != null) return listing.originalPriceCents;
  return listing.priceCents;
}

/** What a trade adds up to. Trade credit covers our cards only; shipping is paid by card. */
export interface TradeComparison {
  /** Our cards, at their trade (retail) prices. */
  wantedCents: number;
  /** Shipping our cards to the customer, paid by card. */
  shippingCents: number;
  /** Their cards' market value (estimated, approved or final). */
  offeredValueCents: number;
  creditCents: number;
  /** The market value of their cards it takes to cover our cards at the trade rate. */
  requiredValueCents: number;
  /** Credit spent on our cards. */
  creditAppliedCents: number;
  /** Our cards the credit doesn't cover (paid by card). */
  cardBalanceCents: number;
  /** Everything paid by card at the end: the card balance plus shipping. */
  cashDueCents: number;
  /** Credit beyond our cards; kept as store credit. 0 when there's none. */
  excessCents: number;
  /** About how much more card value would cover our cards; 0 when covered. */
  moreValueNeededCents: number;
}

export function tradeComparison(input: {
  wantedCents: number;
  offeredValueCents: number;
  ratePercent: number;
  feeCents?: number;
  /** Shipping our cards; defaults to the tiers in `shipping` for `wantedCents`. */
  shippingCents?: number;
  shipping?: ShippingTerms;
}): TradeComparison {
  const fee = input.feeCents ?? 0;
  const shippingCents = input.shippingCents ?? tradeShippingCents(input.wantedCents, input.shipping ?? DEFAULT_SHIPPING_TERMS);
  const creditCents = tradeCreditCents(input.offeredValueCents, input.ratePercent, fee);
  const creditAppliedCents = Math.min(creditCents, input.wantedCents);
  const cardBalanceCents = input.wantedCents - creditAppliedCents;
  const requiredValueCents = valueForCreditCents(input.wantedCents, input.ratePercent, fee);
  return {
    wantedCents: input.wantedCents,
    shippingCents,
    offeredValueCents: input.offeredValueCents,
    creditCents,
    requiredValueCents,
    creditAppliedCents,
    cardBalanceCents,
    cashDueCents: cardBalanceCents + shippingCents,
    excessCents: Math.max(creditCents - input.wantedCents, 0),
    moreValueNeededCents: Math.max(requiredValueCents - input.offeredValueCents, 0),
  };
}

/** A trade's own shipping terms (each keeps the ones it started on). */
export function tradeShippingTerms(t: { shipFeeCents: number; freeShipThresholdCents: number; freeShipFeeCents: number }): ShippingTerms {
  return { shipFeeCents: t.shipFeeCents, freeShipThresholdCents: t.freeShipThresholdCents, freeShipFeeCents: t.freeShipFeeCents };
}

/**
 * Copies of one of the customer's cards that arrived but that we didn't
 * take (turned down at inspection, or the extra copies of one we took part
 * of): they go back to the customer. Works on the views and on table rows.
 */
export function copiesToReturn(card:
  | { inspected: boolean; receivedQuantity: number | null; finalQuantity: number | null }
  | { inspected_at: string | null; received_quantity: number | null; final_quantity: number | null }): number {
  const inspected = "inspected" in card ? card.inspected : card.inspected_at !== null;
  if (!inspected) return 0;
  const received = "receivedQuantity" in card ? card.receivedQuantity : card.received_quantity;
  const taken = "finalQuantity" in card ? card.finalQuantity : card.final_quantity;
  return Math.max((received ?? 0) - (taken ?? 0), 0);
}

/** Cash for credit beyond the order, when staff offer it: the same card value at the cash rate. */
export function cashForExcessCents(excessCreditCents: number, creditRatePercent: number, cashRatePercent: number): number {
  if (excessCreditCents <= 0 || creditRatePercent <= 0) return 0;
  return Math.round((excessCreditCents * cashRatePercent) / creditRatePercent);
}

/** One card's change from what was approved to the final offer, with its reason. */
export interface OfferChange {
  cardId: string;
  cardName: string;
  approvedQuantity: number;
  approvedUnitCents: number;
  finalQuantity: number;
  finalUnitCents: number;
  /** final value less approved value (negative: less than approved). */
  differenceCents: number;
  /** Why, in the customer's words: the condition seen, flags and staff's note. */
  reasons: string[];
}

const FLAG_REASONS: Record<string, string> = {
  damaged: "Damaged",
  counterfeit: "Not authentic",
  incorrect: "Different printing, version or language than listed",
  missing: "Not in the package",
};

/**
 * The cards whose final value differs from what was approved before
 * shipping, and why. Cards that arrived exactly as approved aren't listed.
 */
export function offerChanges(cards: readonly TradeOfferCard[]): OfferChange[] {
  return cards.flatMap((c) => {
    const approvedQuantity = c.reviewStatus === "approved" ? (c.approvedQuantity ?? 0) : 0;
    const approvedUnitCents = c.approvedUnitCents ?? 0;
    const finalQuantity = c.inspected ? (c.finalQuantity ?? 0) : 0;
    const finalUnitCents = c.finalUnitCents ?? 0;
    if (approvedQuantity === 0 && finalQuantity === 0) return [];
    const same = finalQuantity === approvedQuantity && (finalQuantity === 0 || finalUnitCents === approvedUnitCents);
    if (same) return [];
    const reasons: string[] = [];
    if (c.verifiedCondition && c.verifiedCondition !== c.reportedCondition) {
      reasons.push(`Condition: ${CONDITION_NAMES[c.verifiedCondition]} (listed as ${CONDITION_NAMES[c.reportedCondition]})`);
    }
    for (const f of c.flags) if (FLAG_REASONS[f]) reasons.push(FLAG_REASONS[f]);
    if (c.receivedQuantity !== null && c.receivedQuantity < approvedQuantity) {
      reasons.push(`${c.receivedQuantity} of ${approvedQuantity} arrived`);
    }
    if (c.inspectionNote) reasons.push(c.inspectionNote);
    return [
      {
        cardId: c.id,
        cardName: cardLine(c),
        approvedQuantity,
        approvedUnitCents,
        finalQuantity,
        finalUnitCents,
        differenceCents: finalQuantity * finalUnitCents - approvedQuantity * approvedUnitCents,
        reasons,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/** "2 days", "5 hours", "under an hour": time left until a deadline. */
export function timeLeft(untilMs: number, nowMs: number): string {
  const ms = untilMs - nowMs;
  if (ms <= 0) return "no time";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 1) return hours === 1 ? "1 hour" : `${hours} hours`;
  return "under an hour";
}

/** A deadline as customers read it: "Tue, Oct 27, 2:00 PM CT". */
export function formatDeadline(iso: string): string {
  return formatStoreDeadline(iso);
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
  /** Not used by the server: it sets the condition from the printing's age (tradeConditions). */
  condition?: CardConditionCode;
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
  /** requested: on the trade, not held; reserved: held; released: let go; removed: taken off; fulfilled: on the order. */
  status: "requested" | "reserved" | "released" | "removed" | "fulfilled";
  /** How many are free right now (for a trade that isn't reserved yet); null when it doesn't matter. */
  available: number | null;
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

/** The deposit on a trade, as its customer sees it. */
export interface TradeDeposit {
  /** What's required (0: none). */
  cents: number;
  status: DepositStatus;
  reason: DepositReason | null;
  paidCents: number | null;
  paidAt: string | null;
  refundRequestedAt: string | null;
  refundedAt: string | null;
}

/** Their package, as tracked. */
export interface TradeShipment {
  carrier: string | null;
  tracking: string | null;
  trackingAddedAt: string | null;
  /** The carrier's latest status (pre_transit, in_transit, …), when tracked automatically. */
  carrierStatus: string | null;
  scans: TrackingScan[];
  checkedAt: string | null;
  /** When the carrier first had it (or staff verified it). */
  acceptedAt: string | null;
  acceptanceSource: "carrier" | "staff" | "received" | null;
  shippedOnTime: boolean | null;
  deliveredAt: string | null;
  /** The scans are checked automatically (otherwise staff verify by hand). */
  autoTracked: boolean;
  /** The day they say they shipped ("YYYY-MM-DD"; optional, the carrier's scan is what counts). */
  shippedOn: string | null;
  /** When they confirmed the package is protected and tracked (for this tracking number). */
  packagingConfirmedAt: string | null;
}

/** Our cards on their way to the customer (the trade's order). */
export interface TradeOutgoing {
  /** The order's status: paid, packing, ready_to_ship, shipped, delivered… */
  status: string;
  carrier: string | null;
  tracking: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

/** What the confirmation page needs, worked out by the server. */
export interface TradeConfirmation {
  confirmBy: string;
  depositCents: number;
  depositReason: DepositReason | null;
  termsText: string;
  termsVersion: number;
  /** Qualifying days to ship once reserved (this customer's window). */
  shipDays: number;
  /** The shipping deadline if they confirmed now (the real one starts when the cards are reserved). */
  shipByIfConfirmedNow: string;
  /** Paying the deposit online works right now. */
  canPayOnline: boolean;
  /**
   * Local pickup: there's no shipping and never a deposit. shipDays and
   * shipByIfConfirmedNow are then the days our cards are held for the
   * meetup, and when that hold would end if they confirmed now.
   */
  local: boolean;
}

/** Proof of shipping the customer sent. */
export interface TradeDisputeView {
  id: string;
  status: "open" | "accepted" | "rejected";
  note: string;
  files: { name: string; size: number; type: string; url?: string | null }[];
  createdAt: string;
  resolvedAt: string | null;
}

/** A trade, as its customer sees it: nothing staff-only. */
export interface CustomerTrade {
  id: string;
  tradeNumber: number;
  status: TradeStatus;
  /** By mail, or in person (local pickup). */
  handoffMethod: TradeHandoffMethod;
  /** Local pickup: where and when to meet, as we wrote it. */
  meetupDetails: string | null;
  /** Local pickup: when we finished the trade at the meetup. */
  metAt: string | null;
  /** Local pickup: how they paid the difference in person. */
  localPaymentMethod: "none" | "cash" | "card" | "other" | null;
  localPaidCents: number | null;
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
  /** Shipping our cards, settled when they accept the final offer. */
  shippingCents: number | null;
  amountDueCents: number | null;
  excessCents: number | null;
  excessHandling: "store_credit" | "cash";
  cashPayoutCents: number | null;
  /** The shipping terms the trade started on. */
  shipFeeCents: number;
  freeShipThresholdCents: number;
  freeShipFeeCents: number;
  /** A draft or revision closes after this. */
  listDueAt: string | null;
  /** An approved trade must be confirmed by this. */
  confirmBy: string | null;
  /** The carrier must accept their package by this. */
  shipBy: string | null;
  shipDays: number | null;
  paymentDueAt: string | null;
  confirmedAt: string | null;
  reservedAt: string | null;
  approvalConditions: string | null;
  deposit: TradeDeposit;
  shipment: TradeShipment;
  returnStatus: "none" | "pending" | "returned";
  returnCarrier: string | null;
  returnTracking: string | null;
  expiredStage: string | null;
  orderId: string | null;
  creditIssuedCents: number | null;
  customerNote: string | null;
  closeReason: string | null;
  /** Where our cards ship (once they accept the final offer). */
  shipTo: TradeAddress | null;
  /** Our cards on their way to them, once the trade's order exists. */
  outgoing: TradeOutgoing | null;
  wanted: TradeWantedItem[];
  offered: TradeOfferCard[];
  messages: TradeMessage[];
  timeline: TradeTimelineEntry[];
  /** Where to mail their cards: once our cards are reserved. */
  mailTo: TradeAddress | null;
  packingInstructions: string | null;
  returnPolicy: string;
  /** While the trade waits for their confirmation or deposit. */
  confirmation: TradeConfirmation | null;
  disputes: TradeDisputeView[];
  /** They can send proof of shipping now (until this time, for an expired reservation). */
  canSendProof: boolean;
  proofDueAt: string | null;
}

/** A row in My Trades. */
export interface CustomerTradeSummary {
  id: string;
  tradeNumber: number;
  status: TradeStatus;
  handoffMethod: TradeHandoffMethod;
  createdAt: string;
  updatedAt: string;
  wantedTotalCents: number;
  wantedCount: number;
  offeredCount: number;
  listDueAt: string | null;
  confirmBy: string | null;
  shipBy: string | null;
  paymentDueAt: string | null;
  depositStatus: DepositStatus;
  depositCents: number;
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

/** The deposit, with what only staff see. */
export interface StaffTradeDeposit extends TradeDeposit {
  override: DepositOverride;
  paymentIntentId: string | null;
  refundId: string | null;
  refundAttempts: number;
  refundFailure: string | null;
  /** Stripe's fee on it (kept by Stripe; never taken from the refund). */
  feeCents: number | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
}

export interface TradeExtensionView {
  id: string;
  kind: "list" | "confirmation" | "shipping" | "payment";
  fromDeadline: string | null;
  toDeadline: string;
  hours: number | null;
  customerRequested: boolean;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface TradeConsentView {
  termsVersion: number;
  termsText: string;
  depositCents: number;
  shipDays: number | null;
  confirmBy: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export type TradeReviewFlag = "late_acceptance" | "early_scan" | "tracking_check" | "dispute";
export type TradeCustomerFault = "canceled_while_reserved" | "missed_deadline" | "late_shipment";

/** A trade, as staff see it: everything. */
export interface StaffTrade extends Omit<CustomerTrade, "offered" | "timeline" | "deposit" | "disputes"> {
  userId: string;
  customerName: string | null;
  customerEmail: string | null;
  offered: StaffTradeOfferCard[];
  events: StaffTradeEvent[];
  deposit: StaffTradeDeposit;
  disputes: (TradeDisputeView & { staffNote: string | null; resolvedBy: string | null })[];
  extensions: TradeExtensionView[];
  consents: TradeConsentView[];
  reviewFlag: TradeReviewFlag | null;
  reviewFlagAt: string | null;
  customerFault: TradeCustomerFault | null;
  faultAt: string | null;
  faultClearedAt: string | null;
  faultClearedBy: string | null;
  confirmByOriginal: string | null;
  shipByOriginal: string | null;
  needsStaff: boolean;
  /** The customer's record and what it earns them (null if it couldn't be loaded). */
  customerRecord: CustomerRecord | null;
  privileges: Privileges | null;
  submittedAt: string | null;
  approvedAt: string | null;
  receivedAt: string | null;
  finalOfferAt: string | null;
  acceptedAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  returnedAt: string | null;
  cashPaidAt: string | null;
  paymentReference: string | null;
  /** What shipping our cards cost: a label bought through EasyPost (on the order), or what staff recorded. */
  orderPostageCents: number | null;
  outboundPostageCents: number | null;
}

/** A row in admin Trades. */
export interface StaffTradeSummary {
  id: string;
  tradeNumber: number;
  status: TradeStatus;
  handoffMethod: TradeHandoffMethod;
  customerName: string | null;
  customerEmail: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  wantedTotalCents: number;
  estimatedValueCents: number;
  approvedValueCents: number | null;
  finalValueCents: number | null;
  listDueAt: string | null;
  confirmBy: string | null;
  shipBy: string | null;
  paymentDueAt: string | null;
  inboundCarrier: string | null;
  inboundTracking: string | null;
  inboundAcceptedAt: string | null;
  depositStatus: DepositStatus;
  depositCents: number;
  depositPaidCents: number | null;
  reviewFlag: TradeReviewFlag | null;
  returnStatus: "none" | "pending" | "returned";
  customerFault: TradeCustomerFault | null;
  needsStaff: boolean;
}

/** trade_settings as staff edit it (admin Trades, Settings). */
export interface TradeSettings {
  enabled: boolean;
  paused: boolean;
  pauseMessage: string;
  creditRatePercent: number;
  minCardValueCents: number;
  conditionPercents: ConditionPercents;
  draftDays: number;
  revisionHours: number;
  confirmationHours: number;
  shipDaysNew: number;
  shipDaysTier1: number;
  shipDaysTier2: number;
  loyaltyTier1Trades: number;
  loyaltyTier2Trades: number;
  scanGraceHours: number;
  excludedDates: string[];
  paymentDueDays: number;
  maxTransitDays: number;
  stallAlertDays: number;
  confirmReminderHours: number;
  shipReminderHours: number;
  disputeWindowDays: number;
  depositsEnabled: boolean;
  depositThresholdCents: number;
  depositBand1MaxCents: number;
  depositBand2MaxCents: number;
  depositBand3MaxCents: number;
  depositBand1Cents: number;
  depositBand2Cents: number;
  depositBand3Cents: number;
  depositBand4Cents: number;
  allowForfeiture: boolean;
  depositTerms: string;
  depositTermsVersion: number;
  abandonLimit: number;
  abandonWindowDays: number;
  abandonPolicy: "deposit" | "block";
  maxActiveTrades: number;
  maxWantedLines: number;
  maxOfferedLines: number;
  minTradeValueCents: number;
  maxTradeValueCents: number | null;
  processingFeeCents: number;
  cashPayoutEnabled: boolean;
  cashRatePercent: number;
  overstockThreshold: number;
  excludedSetCodes: string[];
  excludedCardNames: string[];
  notifyCustomer: boolean;
  notifyStaff: boolean;
  shippingPaidBy: "customer" | "store";
  shipFeeCents: number;
  freeShipThresholdCents: number;
  freeShipFeeCents: number;
  /** What a shipment of our cards actually costs us, for the internal economics only. */
  shipCostEstimateCents: number;
  shipTo: TradeAddress | null;
  packingInstructions: string;
  returnPolicy: string;
  localPickupEnabled: boolean;
  localPickupArea: string;
  localMeetDays: number;
  localPickupDetails: string;
  updatedAt: string | null;
}

/** The numeric settings and the ranges the database allows for each. */
export const TRADE_SETTING_RANGES = {
  creditRatePercent: [1, 100],
  minCardValueCents: [0, 10_000_000],
  conditionPercent: [0, 100],
  draftDays: [1, 90],
  revisionHours: [1, 720],
  confirmationHours: [1, 336],
  shipDays: [1, 30],
  loyaltyTrades: [1, 1000],
  scanGraceHours: [0, 168],
  paymentDueDays: [1, 60],
  maxTransitDays: [1, 90],
  stallAlertDays: [1, 30],
  reminderHours: [0, 72],
  disputeWindowDays: [1, 90],
  depositThresholdCents: [0, 100_000_000],
  depositBandMaxCents: [1, 100_000_000],
  depositCents: [50, 100_000],
  abandonLimit: [1, 20],
  abandonWindowDays: [30, 3650],
  maxActiveTrades: [1, 20],
  maxWantedLines: [1, 200],
  maxOfferedLines: [1, 500],
  minTradeValueCents: [0, 100_000_000],
  maxTradeValueCents: [1, 100_000_000],
  processingFeeCents: [0, 1_000_000],
  cashRatePercent: [1, 100],
  overstockThreshold: [0, 1000],
  maxExcludedDates: [0, 200],
  shipFeeCents: [0, 10_000],
  freeShipThresholdCents: [1, 100_000_000],
  shipCostEstimateCents: [0, 10_000],
  localMeetDays: [1, 30],
} as const;

/** How a local pickup trade's difference was paid in person, as staff and customers read it. */
export const LOCAL_PAYMENT_LABELS: Record<"none" | "cash" | "card" | "other", string> = {
  none: "Nothing to pay",
  cash: "Cash",
  card: "Card",
  other: "Other",
};

// ---------------------------------------------------------------------------
// Formatting (here so the emails and the pages say the same thing)
// ---------------------------------------------------------------------------

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "DMU #107 · Foil": a printing's set, collector number and (if not non-foil) finish. */
export function printingLabel(card: { setCode: string | null; collectorNumber: string | null; finish: string }): string {
  const where = [card.setCode?.toUpperCase(), card.collectorNumber ? `#${card.collectorNumber}` : null].filter(Boolean).join(" ");
  const finish = card.finish !== "nonfoil" ? (FINISH_NAMES[card.finish] ?? card.finish) : null;
  return [where, finish].filter(Boolean).join(" · ");
}

/** "Sheoldred, the Apocalypse (DMU #107, foil)". */
export function cardLine(card: { cardName: string; setCode: string | null; collectorNumber: string | null; finish: string }): string {
  const where = [card.setCode?.toUpperCase(), card.collectorNumber ? `#${card.collectorNumber}` : null].filter(Boolean).join(" ");
  const finish = card.finish !== "nonfoil" ? (FINISH_NAMES[card.finish] ?? card.finish).toLowerCase() : null;
  const extra = [where, finish].filter(Boolean).join(", ");
  return extra ? `${card.cardName} (${extra})` : card.cardName;
}
