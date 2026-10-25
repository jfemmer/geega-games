import { parsePriceCents } from "../../utils/tradeEvaluator";
import type { InspectCardInput, ReviewCardInput, TradeAuthenticity, TradeCardFlag } from "../../repositories/tradeCenter.supabase";
import {
  TRADE_LIMITS,
  addBusinessDays,
  cashForExcessCents,
  conditionPercent,
  tradeCreditCents,
  tradeShippingCents,
  type CardConditionCode,
  type ConditionPercents,
  type StaffTrade,
  type StaffTradeOfferCard,
  type TradeSettings,
} from "../../../store/lib/tradeCenter";

// The arithmetic behind admin Trades: what a trade adds up to at each stage,
// the review and inspection forms' starting values and what they send, and
// the final offer preview. The server works every total out again (in the
// database); this mirrors it so staff see the same numbers before they act.

const STORE_TIME_ZONE = "America/Chicago";
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** The ship-by date the server uses when staff don't pick one. */
export function defaultShipByInput(settings: Pick<TradeSettings, "shipBusinessDays">, now = Date.now()): string {
  return storeDateInput(addBusinessDays(now, settings.shipBusinessDays));
}

/** Dates the server accepts for a ship-by date: today through the next 59 days. */
export function shipByBounds(now = Date.now()): { min: string; max: string } {
  return { min: storeDateInput(now), max: storeDateInput(now + 59 * DAY_MS) };
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
  shippingCents: number;
  /** The customer pays this by card (0 when the credit covers everything). */
  dueCents: number;
  /** Credit beyond our cards and shipping. */
  excessCents: number;
  /** Cash staff pay by hand for the excess, when the final offer included it. */
  cashCents: number;
}

export function tradeMoney(t: StaffTrade): TradeMoney {
  const valueStage = t.finalValueCents != null ? "final" : t.approvedValueCents != null ? "approved" : "estimated";
  const valueCents = t.finalValueCents ?? t.approvedValueCents ?? t.estimatedValueCents;
  const creditCents = t.finalCreditCents ?? tradeCreditCents(valueCents, t.creditRatePercent, t.processingFeeCents);
  const shippingCents = t.shippingCents ?? tradeShippingCents(t.wantedTotalCents);
  const total = t.wantedTotalCents + shippingCents;
  return {
    wantedCents: t.wantedTotalCents,
    valueCents,
    valueStage,
    creditCents,
    shippingCents,
    dueCents: t.amountDueCents ?? Math.max(total - creditCents, 0),
    excessCents: t.excessCents ?? Math.max(creditCents - total, 0),
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
    unit: centsInput(card.reviewStatus === "approved" ? card.approvedUnitCents : card.estimatedUnitCents),
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
  if (unit === null) return { problem: `${card.cardName}: enter a value for each copy.` };
  return { id: card.id, reviewStatus: "approved", approvedQuantity: draft.quantity, approvedUnitCents: unit, ...notes };
}

export interface ReviewTally {
  approved: number;
  rejected: number;
  pending: number;
  /** Approved copies × value each, as the drafts stand. */
  approvedValueCents: number;
}

export function reviewTally(cards: StaffTradeOfferCard[], drafts: Record<string, ReviewDraft>): ReviewTally {
  const tally: ReviewTally = { approved: 0, rejected: 0, pending: 0, approvedValueCents: 0 };
  for (const card of cards) {
    const d = drafts[card.id] ?? reviewDraftOf(card);
    tally[d.decision] += 1;
    if (d.decision === "approved") tally.approvedValueCents += d.quantity * (parseUnitCents(d.unit) ?? 0);
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
  shippingCents: number;
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
  const shippingCents = tradeShippingCents(t.wantedTotalCents);
  const total = t.wantedTotalCents + shippingCents;
  const excessCents = Math.max(creditCents - total, 0);
  return {
    valueCents,
    creditCents,
    wantedCents: t.wantedTotalCents,
    shippingCents,
    dueCents: Math.max(total - creditCents, 0),
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
