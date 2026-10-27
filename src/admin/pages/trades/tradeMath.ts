import { parsePriceCents } from "../../utils/tradeEvaluator";
import type { InspectCardInput, ReviewCardInput, TradeAuthenticity, TradeCardFlag } from "../../repositories/tradeCenter.supabase";
import {
  TRADE_LIMITS,
  cashForExcessCents,
  conditionPercent,
  tradeCreditCents,
  tradeShippingTerms,
  type CardConditionCode,
  type ConditionPercents,
  type StaffTrade,
  type StaffTradeOfferCard,
  type TradeSettings,
} from "../../../store/lib/tradeCenter";
import { STORE_TIME_ZONE, addQualifyingDays, addQualifyingHours } from "../../../store/lib/tradeDeadlines";
import { depositFor, type DepositDecision, type DepositOverride } from "../../../store/lib/tradeRules";
import { tradeShippingCents } from "../../../store/lib/tradeShipping";

// The arithmetic behind admin Trades: what a trade adds up to at each stage,
// the deadlines and deposit an action would set, the review and inspection
// forms' starting values and what they send, and the final offer preview.
// The server works every total, deadline and deposit out again; this
// mirrors it so staff see the same numbers before they act.

/** YYYY-MM-DD of the day `ms` falls on in St. Louis (for a date input). */
export function storeDateInput(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A date input's YYYY-MM-DD as "Tue, Oct 27". */
export function formatDateInput(value: string): string {
  const noon = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(noon)) return value;
  return new Date(noon).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** When an approval made now has to be confirmed by (qualifying hours: Sundays and excluded days don't count). */
export function confirmByPreview(settings: Pick<TradeSettings, "confirmationHours" | "excludedDates">, now = Date.now()): number {
  return addQualifyingHours(now, settings.confirmationHours, settings.excludedDates);
}

/** The shipping deadline `days` qualifying days from now (reinstating a reservation). */
export function shipByPreview(days: number, settings: Pick<TradeSettings, "excludedDates">, now = Date.now()): number {
  return addQualifyingDays(now, days, settings.excludedDates);
}

/** The deadline after giving `hours` more: confirmation and shipping count qualifying hours, the others plain hours. */
export function extendedDeadline(
  kind: "list" | "confirmation" | "shipping" | "payment",
  currentIso: string | null,
  hours: number,
  settings: Pick<TradeSettings, "excludedDates">,
  now = Date.now(),
): number {
  const from = Math.max(now, currentIso ? Date.parse(currentIso) : 0);
  return kind === "confirmation" || kind === "shipping" ? addQualifyingHours(from, hours, settings.excludedDates) : from + hours * 3_600_000;
}

/** The deposit approving now would set, as the server works it out (the customer's record and the override). */
export function depositPreview(trade: StaffTrade, settings: TradeSettings, override: DepositOverride): DepositDecision {
  return depositFor(
    {
      wantedCents: trade.wantedTotalCents,
      override,
      customerRequired: trade.customerRecord?.depositRequired ?? false,
      reliabilityRequired: trade.privileges?.reliabilityDeposit ?? false,
    },
    settings,
  );
}

/** min…max, for a quantity select. */
export function quantityOptions(min: number, max: number): number[] {
  const out: number[] = [];
  for (let n = min; n <= max; n += 1) out.push(n);
  return out;
}

/** Cents as a dollar input ("12.50"); blank for none. */
export function centsInput(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

/** A typed dollar amount in cents, within what a trade allows; null when it isn't one. */
export function parseUnitCents(input: string): number | null {
  const cents = parsePriceCents(input);
  return cents !== null && cents <= TRADE_LIMITS.maxEstimateCents ? cents : null;
}

// ---------------------------------------------------------------------------
// What a trade adds up to
// ---------------------------------------------------------------------------

export interface TradeMoney {
  /** Our cards, at their trade prices. */
  wantedCents: number;
  /** Their cards: the latest of the estimate, the approved value and the final value. */
  valueCents: number;
  valueStage: "estimated" | "approved" | "final";
  creditCents: number;
  /** Shipping our cards to the customer: paid by card, never out of trade credit. */
  shippingCents: number;
  /** Our cards the credit doesn't cover. */
  cardBalanceCents: number;
  /** The customer pays this by card: the card balance plus shipping. */
  dueCents: number;
  /** Credit beyond our cards (kept as store credit, or paid in cash when the final offer included it). */
  excessCents: number;
  /** Cash staff pay by hand for the excess, when the final offer included it. */
  cashCents: number;
}

export function tradeMoney(t: StaffTrade): TradeMoney {
  const valueStage = t.finalValueCents != null ? "final" : t.approvedValueCents != null ? "approved" : "estimated";
  const valueCents = t.finalValueCents ?? t.approvedValueCents ?? t.estimatedValueCents;
  const creditCents = t.finalCreditCents ?? tradeCreditCents(valueCents, t.creditRatePercent, t.processingFeeCents);
  const shippingCents = t.shippingCents ?? tradeShippingCents(t.wantedTotalCents, tradeShippingTerms(t));
  const cardBalanceCents = Math.max(t.wantedTotalCents - creditCents, 0);
  return {
    wantedCents: t.wantedTotalCents,
    valueCents,
    valueStage,
    creditCents,
    shippingCents,
    cardBalanceCents,
    dueCents: t.amountDueCents ?? cardBalanceCents + shippingCents,
    excessCents: t.excessCents ?? Math.max(creditCents - t.wantedTotalCents, 0),
    cashCents: t.excessHandling === "cash" ? (t.cashPayoutCents ?? 0) : 0,
  };
}

// ---------------------------------------------------------------------------
// Review (pending_review): approve or reject each card
// ---------------------------------------------------------------------------

export type ReviewDecision = "pending" | "approved" | "rejected";

export interface ReviewDraft {
  decision: ReviewDecision;
  quantity: number;
  /** Value each, as typed. */
  unit: string;
  reviewNote: string;
  internalNote: string;
}

export function reviewDraftOf(card: StaffTradeOfferCard): ReviewDraft {
  return {
    decision: card.reviewStatus,
    quantity: card.reviewStatus === "approved" && card.approvedQuantity ? card.approvedQuantity : card.quantity,
    // Staff type each card's TCG low; nothing is filled in from the market estimate.
    unit: centsInput(card.reviewStatus === "approved" ? card.approvedUnitCents : null),
    reviewNote: card.reviewNote ?? "",
    internalNote: card.internalNote ?? "",
  };
}

/** Staff changed this card's review from what's saved. */
export function reviewChanged(card: StaffTradeOfferCard, draft: ReviewDraft): boolean {
  const saved = reviewDraftOf(card);
  if (draft.decision !== saved.decision) return true;
  if (draft.reviewNote.trim() !== saved.reviewNote.trim() || draft.internalNote.trim() !== saved.internalNote.trim()) return true;
  if (draft.decision !== "approved") return false;
  return draft.quantity !== saved.quantity || parseUnitCents(draft.unit) !== parseUnitCents(saved.unit);
}

/** What the review sends for one card, or the problem with it. */
export function reviewInput(card: StaffTradeOfferCard, draft: ReviewDraft): ReviewCardInput | { problem: string } {
  const notes = { reviewNote: draft.reviewNote.trim() || null, internalNote: draft.internalNote.trim() || null };
  if (draft.decision !== "approved") {
    return { id: card.id, reviewStatus: draft.decision, approvedQuantity: null, approvedUnitCents: null, ...notes };
  }
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > card.quantity) {
    return { problem: `${card.cardName}: approve 1 to ${card.quantity}.` };
  }
  const unit = parseUnitCents(draft.unit);
  if (unit === null) return { problem: `${card.cardName}: enter its TCG low (each).` };
  return { id: card.id, reviewStatus: "approved", approvedQuantity: draft.quantity, approvedUnitCents: unit, ...notes };
}

export interface ReviewTally {
  approved: number;
  rejected: number;
  pending: number;
  /** Approved cards with no TCG low typed in yet. */
  unpriced: number;
  /** Approved copies × value each, as the drafts stand. */
  approvedValueCents: number;
}

export function reviewTally(cards: StaffTradeOfferCard[], drafts: Record<string, ReviewDraft>): ReviewTally {
  const tally: ReviewTally = { approved: 0, rejected: 0, pending: 0, unpriced: 0, approvedValueCents: 0 };
  for (const card of cards) {
    const d = drafts[card.id] ?? reviewDraftOf(card);
    tally[d.decision] += 1;
    if (d.decision !== "approved") continue;
    const unit = parseUnitCents(d.unit);
    if (unit === null) tally.unpriced += 1;
    else tally.approvedValueCents += d.quantity * unit;
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Inspection (received, under_inspection): what arrived and what it's worth
// ---------------------------------------------------------------------------

export const TRADE_CARD_FLAGS: { value: TradeCardFlag; label: string }[] = [
  { value: "damaged", label: "Damaged" },
  { value: "incorrect", label: "Wrong card or printing" },
  { value: "missing", label: "Missing copies" },
  { value: "counterfeit", label: "Counterfeit" },
];

export const AUTHENTICITY_LABELS: Record<TradeAuthenticity, string> = {
  unchecked: "Not checked",
  authentic: "Authentic",
  unsure: "Not sure",
  counterfeit: "Counterfeit",
};

export interface InspectDraft {
  received: number;
  authenticity: TradeAuthenticity;
  condition: CardConditionCode;
  accept: number;
  /** Value each, as typed. */
  unit: string;
  flags: TradeCardFlag[];
  note: string;
  internalNote: string;
}

function knownFlags(flags: string[]): TradeCardFlag[] {
  return TRADE_CARD_FLAGS.map((f) => f.value).filter((f) => flags.includes(f));
}

/** Starting values: what was saved, or (not inspected yet) everything as approved. */
export function inspectDraftOf(card: StaffTradeOfferCard): InspectDraft {
  const approved = card.approvedQuantity ?? card.quantity;
  if (card.inspected) {
    return {
      received: card.receivedQuantity ?? 0,
      authenticity: card.authenticity,
      condition: card.verifiedCondition ?? card.reportedCondition,
      accept: card.finalQuantity ?? 0,
      unit: centsInput(card.finalUnitCents ?? card.approvedUnitCents),
      flags: knownFlags(card.flags),
      note: card.inspectionNote ?? "",
      internalNote: card.inspectionInternalNote ?? "",
    };
  }
  return {
    received: approved,
    authenticity: "authentic",
    condition: card.reportedCondition,
    accept: approved,
    unit: centsInput(card.approvedUnitCents),
    flags: [],
    note: "",
    internalNote: "",
  };
}

export function inspectChanged(card: StaffTradeOfferCard, draft: InspectDraft): boolean {
  const saved = inspectDraftOf(card);
  return (
    draft.received !== saved.received ||
    draft.authenticity !== saved.authenticity ||
    draft.condition !== saved.condition ||
    draft.accept !== saved.accept ||
    parseUnitCents(draft.unit) !== parseUnitCents(saved.unit) ||
    draft.flags.join() !== saved.flags.join() ||
    draft.note.trim() !== saved.note.trim() ||
    draft.internalNote.trim() !== saved.internalNote.trim()
  );
}

/**
 * Value each in a condition other than the one the customer reported: the
 * approved value scaled by the trade's condition percentages (or, with no
 * approved value, the reference price at the new condition's percentage).
 */
export function unitForCondition(
  card: StaffTradeOfferCard,
  condition: CardConditionCode,
  percents: ConditionPercents,
): number | null {
  const reported = conditionPercent(percents, card.reportedCondition);
  const next = conditionPercent(percents, condition);
  if (card.approvedUnitCents != null && reported > 0) return Math.round((card.approvedUnitCents * next) / reported);
  if (card.referencePriceCents != null) return Math.round((card.referencePriceCents * next) / 100);
  return card.approvedUnitCents;
}

/** The draft after staff change one thing, kept consistent (the database checks the same rules). */
export function updateInspectDraft(
  card: StaffTradeOfferCard,
  draft: InspectDraft,
  patch: Partial<InspectDraft>,
  percents: ConditionPercents,
): InspectDraft {
  const next = { ...draft, ...patch };
  if (patch.condition && patch.condition !== draft.condition) {
    const unit = unitForCondition(card, patch.condition, percents);
    if (unit !== null) next.unit = centsInput(unit);
  }
  if (patch.authenticity === "counterfeit") {
    next.accept = 0;
    if (!next.flags.includes("counterfeit")) next.flags = knownFlags([...next.flags, "counterfeit"]);
  }
  if (next.accept > next.received) next.accept = next.received;
  if (next.authenticity === "counterfeit") next.accept = 0;
  return next;
}

export function inspectInput(card: StaffTradeOfferCard, draft: InspectDraft): InspectCardInput | { problem: string } {
  if (!Number.isInteger(draft.received) || draft.received < 0 || draft.received > TRADE_LIMITS.maxQuantity) {
    return { problem: `${card.cardName}: how many arrived?` };
  }
  if (!Number.isInteger(draft.accept) || draft.accept < 0 || draft.accept > draft.received) {
    return { problem: `${card.cardName}: accept 0 to ${draft.received} (as many as arrived).` };
  }
  if (draft.authenticity === "counterfeit" && draft.accept > 0) {
    return { problem: `${card.cardName}: a counterfeit card can't be accepted.` };
  }
  const unit = parseUnitCents(draft.unit);
  if (draft.accept > 0 && unit === null) return { problem: `${card.cardName}: enter a value for each copy you're accepting.` };
  // The final offer explains every change from the approval (the database refuses one that doesn't).
  const approvedQty = card.approvedQuantity ?? 0;
  const changedFromApproval = draft.accept !== approvedQty || (draft.accept > 0 && unit !== card.approvedUnitCents);
  const explained =
    draft.note.trim() !== "" || draft.flags.length > 0 || draft.condition !== card.reportedCondition || draft.authenticity === "counterfeit";
  if (card.reviewStatus === "approved" && changedFromApproval && !explained) {
    return { problem: `${card.cardName}: say why it changed from the approval (a note for the customer, a flag or the condition).` };
  }
  return {
    id: card.id,
    receivedQuantity: draft.received,
    authenticity: draft.authenticity,
    verifiedCondition: draft.condition,
    finalQuantity: draft.accept,
    finalUnitCents: unit ?? 0,
    flags: draft.flags,
    inspectionNote: draft.note.trim() || null,
    inspectionInternalNote: draft.internalNote.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// The final offer, from the saved inspection
// ---------------------------------------------------------------------------

export interface FinalOfferPreview {
  valueCents: number;
  creditCents: number;
  wantedCents: number;
  /** Shipping our cards, paid by card (trade credit covers cards only). */
  shippingCents: number;
  /** Our cards the credit doesn't cover. */
  cardBalanceCents: number;
  /** Paid by card: the card balance plus shipping. */
  dueCents: number;
  excessCents: number;
  /** Cash for the excess at the cash rate, when cash payouts are on. 0 otherwise. */
  cashOptionCents: number;
  /** Approved cards not inspected yet: the final offer waits for them. */
  uninspected: number;
}

export function finalOfferPreview(
  t: StaffTrade,
  settings: Pick<TradeSettings, "cashPayoutEnabled" | "cashRatePercent">,
): FinalOfferPreview {
  const valueCents = t.offered
    .filter((c) => c.inspected && (c.finalQuantity ?? 0) > 0)
    .reduce((sum, c) => sum + (c.finalQuantity ?? 0) * (c.finalUnitCents ?? 0), 0);
  const creditCents = tradeCreditCents(valueCents, t.creditRatePercent, t.processingFeeCents);
  const shippingCents = tradeShippingCents(t.wantedTotalCents, tradeShippingTerms(t));
  const cardBalanceCents = Math.max(t.wantedTotalCents - creditCents, 0);
  const excessCents = Math.max(creditCents - t.wantedTotalCents, 0);
  return {
    valueCents,
    creditCents,
    wantedCents: t.wantedTotalCents,
    shippingCents,
    cardBalanceCents,
    dueCents: cardBalanceCents + shippingCents,
    excessCents,
    cashOptionCents:
      settings.cashPayoutEnabled && excessCents > 0 ? cashForExcessCents(excessCents, t.creditRatePercent, settings.cashRatePercent) : 0,
    uninspected: t.offered.filter((c) => c.reviewStatus === "approved" && !c.inspected).length,
  };
}

/** The customer's latest request for an adjustment, if it came after the final offer went out. */
export function pendingAdjustment(t: StaffTrade): { at: string; message: string | null } | null {
  if (t.status !== "awaiting_final_approval" || !t.finalOfferAt) return null;
  const sent = Date.parse(t.finalOfferAt);
  const asks = t.events.filter((e) => e.event === "adjustment_requested" && Date.parse(e.createdAt) >= sent);
  const last = asks[asks.length - 1];
  if (!last) return null;
  const messageId = typeof last.detail.message_id === "string" ? last.detail.message_id : null;
  const message = messageId ? (t.messages.find((m) => m.id === messageId)?.body ?? null) : null;
  return { at: last.createdAt, message };
}
