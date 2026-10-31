import type { BadgeTone } from "../../utils/labels";
import {
  TRADE_STATUS_ADMIN_LABELS,
  formatDeadline,
  formatUsd,
  isTradeStatus,
  type DepositStatus,
  type StaffTradeEvent,
  type TradeCustomerFault,
  type TradeReviewFlag,
  type TradeStatus,
} from "../../../store/lib/tradeCenter";

// Admin wording for online trades: badge colors, what's flagged for staff,
// history entries and the useful part of an event's detail. Status names
// themselves are shared with the server (TRADE_STATUS_ADMIN_LABELS and
// DEPOSIT_STATUS_ADMIN_LABELS in src/store/lib/tradeCenter.ts).

/** Gold: waiting on you. Purple: waiting on the customer or the mail. */
export const TRADE_STATUS_TONE: Record<TradeStatus, BadgeTone> = {
  awaiting_trade_list: "neutral",
  pending_review: "gold",
  revision_requested: "neutral",
  awaiting_confirmation: "purple",
  awaiting_deposit: "purple",
  awaiting_shipment: "purple",
  tracking_submitted: "purple",
  in_transit: "purple",
  received: "gold",
  under_inspection: "gold",
  awaiting_final_approval: "purple",
  awaiting_payment: "purple",
  approved_for_fulfillment: "info",
  completed: "success",
  rejected: "danger",
  offer_expired: "neutral",
  canceled: "neutral",
  expired: "neutral",
  canceled_after_shipment: "neutral",
  declined_after_inspection: "neutral",
  canceled_by_store: "neutral",
};

/** Gold: staff decide. Red: money that didn't move as it should. */
export const DEPOSIT_STATUS_TONE: Record<DepositStatus, BadgeTone> = {
  not_required: "neutral",
  payment_pending: "purple",
  paid: "info",
  refund_pending: "purple",
  refunded: "success",
  forfeiture_review: "gold",
  forfeited: "danger",
  refund_failed: "danger",
  canceled: "neutral",
};

/** Why a trade is waiting on staff besides its status. */
export const REVIEW_FLAG_LABELS: Record<TradeReviewFlag, string> = {
  late_acceptance: "The carrier's first scan came after the shipping deadline",
  early_scan: "The package was scanned before the trade was approved",
  tracking_check: "This tracking number can't be checked automatically: verify it by hand",
  dispute: "Proof of shipping to review",
};

/** The same, in a few words for the list's "Next" column. */
export const REVIEW_FLAG_SHORT: Record<TradeReviewFlag, string> = {
  late_acceptance: "Late first scan: decide",
  early_scan: "Scanned before approval: check",
  tracking_check: "Verify the shipment by hand",
  dispute: "Proof of shipping to review",
};

export const CUSTOMER_FAULT_LABELS: Record<TradeCustomerFault, string> = {
  canceled_while_reserved: "Canceled after confirming, before shipping",
  missed_deadline: "Didn't ship by the deadline",
  late_shipment: "Shipped after the deadline",
};

/** On the staff list and the drawer: the status, or why it's waiting on staff. */
export function waitingOnStaff(t: { needsStaff: boolean }): boolean {
  return t.needsStaff;
}

/** History, as staff read it (every event, including staff-only ones). */
const EVENT_LABELS: Record<string, string> = {
  started: "Trade started (nothing reserved)",
  wanted_changed: "Our cards on the trade changed",
  submitted: "Customer sent their trade for review",
  resubmitted: "Customer sent their changes",
  cards_reviewed: "Cards reviewed",
  revision_requested: "Asked the customer for changes",
  cards_unavailable: "Some of our cards sold before confirmation: sent back to the customer",
  approved: "Approved: waiting for the customer to confirm",
  deposit_requirement_changed: "Deposit requirement changed",
  deposit_payment_started: "Customer agreed to the terms and started paying the deposit",
  deposit_payment_failed: "Deposit payment failed",
  deposit_paid: "Deposit paid",
  deposit_paid_unusable: "A deposit came in that couldn't reserve anything (refunded)",
  deposit_duplicate_refunded: "A second deposit payment was refunded",
  reservation_conflict: "A card sold while the deposit went through: nothing reserved, deposit refunded",
  reserved: "Our cards reserved",
  deadline_extended: "Deadline extended",
  extension_requested: "Customer asked for more time",
  tracking_added: "Customer added tracking",
  tracking_changed: "Customer changed the tracking number",
  early_scan: "Scanned before approval: flagged",
  late_acceptance: "First scan after the deadline: flagged for review",
  shipment_verified: "Shipment verified (carrier accepted it)",
  delivered: "Delivered",
  received: "Package received",
  dispute_opened: "Customer sent proof of shipping",
  dispute_accepted: "Proof of shipping accepted",
  dispute_rejected: "Proof of shipping rejected",
  deposit_refund_pending: "Deposit refund started",
  deposit_refund_created: "Deposit refund sent to Stripe",
  deposit_refunded: "Deposit refunded",
  deposit_refund_failed: "Deposit refund failed",
  deposit_forfeiture_review: "Deposit put up for review",
  deposit_forfeited: "Deposit kept",
  deposit_canceled: "Deposit not collected",
  fault_cleared: "Customer's record cleared for this trade",
  cards_inspected: "Cards inspected",
  final_offer_sent: "Final offer sent",
  final_offer_withdrawn: "Final offer taken back to revise",
  adjustment_requested: "Customer asked for an adjustment",
  final_accepted: "Customer accepted the final offer",
  paid: "Payment received",
  finalized: "Trade finished; order created",
  completed: "Trade complete (our cards shipped, or handed over in person)",
  rejected: "Rejected",
  offer_expired: "Closed: not sent or confirmed in time",
  canceled: "Canceled by the customer",
  expired: "Reservation expired",
  canceled_after_shipment: "Customer canceled after shipping (no penalty)",
  declined_after_inspection: "Customer declined the final offer (no penalty)",
  canceled_by_store: "Canceled by staff",
  reinstated: "Reservation reinstated",
  arrived_after_expiry: "Package arrived after the reservation expired",
  returned: "Cards mailed back",
  card_imported: "Card added to inventory",
  cash_paid: "Cash paid out",
  postage_recorded: "Postage for our cards recorded",
  reminder_sent: "Reminder emailed to the customer",
  staff_alerted: "Staff alerted",
  handoff_changed: "Customer changed how they'll trade",
  meetup_set: "Meetup details saved",
  met_up: "Met up: their cards recorded and the trade settled in person",
};

const REMINDER_KINDS: Record<string, string> = {
  list_due: "send their trade",
  revision_due: "send their changes",
  confirm_by: "confirm their trade",
  ship_by: "ship their cards",
  no_scan_yet: "no carrier scan yet",
  payment_due: "pay",
  payment_overdue: "payment overdue",
  transit_overdue: "package still in transit",
  stalled: "no carrier update",
  completed: "trade complete",
};

const EXTENSION_KINDS: Record<string, string> = {
  list: "sending the trade",
  confirmation: "confirming",
  shipping: "shipping",
  payment: "paying",
};

export function eventLabel(event: string, toStatus: string | null = null): string {
  // A local pickup trade is held from approval, with nothing for the customer to confirm.
  if (event === "approved" && toStatus === "awaiting_shipment") return "Approved: our cards are held until the trade is finished";
  return EVENT_LABELS[event] ?? event.replace(/_/g, " ");
}

function cents(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? formatUsd(value) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function when(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? formatDeadline(value) : null;
}

function shortNames(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const names = value
    .map((x) => (x && typeof x === "object" && !Array.isArray(x) ? text((x as Record<string, unknown>).card_name) : null))
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

/** The useful part of an event's detail, in a short line (or null). */
export function eventDetail(e: StaffTradeEvent): string | null {
  const d = e.detail;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ") || null;
  switch (e.event) {
    case "approved": {
      const conditions = text(d.conditions);
      return join(
        cents(d.approved_value_cents) ? `Approved value ${cents(d.approved_value_cents)}` : null,
        when(d.confirm_by) ? `confirm by ${when(d.confirm_by)}` : null,
        typeof d.deposit_cents === "number" ? (d.deposit_cents > 0 ? `deposit ${cents(d.deposit_cents)}` : "no deposit") : null,
        conditions ? `Conditions: ${conditions}` : null,
      );
    }
    case "reserved":
      return join(
        when(d.ship_by) ? `ship by ${when(d.ship_by)}` : null,
        typeof d.ship_days === "number" ? `${d.ship_days} days` : null,
        typeof d.deposit_cents === "number" && d.deposit_cents > 0 ? `deposit ${cents(d.deposit_cents)}` : null,
      );
    case "deposit_requirement_changed":
      return join(
        text(d.override),
        cents(d.was_cents) && cents(d.deposit_cents) ? `${cents(d.was_cents)} → ${cents(d.deposit_cents)}` : null,
      );
    case "deposit_payment_started":
      return join(cents(d.deposit_cents), typeof d.terms_version === "number" ? `terms v${d.terms_version}` : null);
    case "deposit_paid":
    case "deposit_paid_unusable":
    case "deposit_duplicate_refunded":
      return cents(d.amount_cents);
    case "reservation_conflict":
    case "cards_unavailable":
      return shortNames(d.short);
    case "deadline_extended":
      return join(
        text(d.kind) ? `For ${EXTENSION_KINDS[text(d.kind) as string] ?? text(d.kind)}` : null,
        when(d.to) ? `now ${when(d.to)}` : null,
        typeof d.hours === "number" ? `${d.hours} more hour${d.hours === 1 ? "" : "s"}` : null,
        d.customer_requested === true ? "customer asked" : null,
        text(d.reason),
      );
    case "extension_requested":
      return text(d.note);
    case "tracking_added":
    case "tracking_changed":
      return join(
        text(d.carrier),
        text(d.tracking),
        text(d.shipped_on) ? `shipped ${text(d.shipped_on)}` : null,
        d.packaging_confirmed === true ? "packaging confirmed" : null,
      );
    case "returned":
      return join(text(d.carrier), text(d.tracking));
    case "postage_recorded":
      return d.postage_cents === null ? "cleared" : cents(d.postage_cents);
    case "final_accepted":
      return join(
        typeof d.shipping_cents === "number" ? `shipping ${d.shipping_cents > 0 ? cents(d.shipping_cents) : "free"}` : null,
        typeof d.amount_due_cents === "number" ? `due ${cents(d.amount_due_cents)}` : null,
      );
    case "early_scan":
    case "late_acceptance":
      return join(when(d.accepted_at) ? `scanned ${when(d.accepted_at)}` : null, when(d.ship_by) ? `deadline ${when(d.ship_by)}` : null);
    case "shipment_verified":
      return join(
        when(d.accepted_at) ? `accepted ${when(d.accepted_at)}` : null,
        d.on_time === true ? "on time" : d.on_time === false ? "late" : null,
        text(d.source) === "staff" ? "verified by staff" : null,
        text(d.note),
      );
    case "delivered":
      return when(d.delivered_at);
    case "dispute_opened":
      return typeof d.files === "number" ? `${d.files} file${d.files === 1 ? "" : "s"}` : null;
    case "dispute_accepted":
    case "dispute_rejected":
      return text(d.note);
    case "final_offer_sent":
      return join(
        cents(d.final_value_cents) ? `Value ${cents(d.final_value_cents)}` : null,
        cents(d.final_credit_cents) ? `credit ${cents(d.final_credit_cents)}` : null,
        typeof d.cash_payout_cents === "number" && d.cash_payout_cents > 0 ? `cash ${cents(d.cash_payout_cents)}` : null,
      );
    case "paid":
    case "cash_paid":
      return join(cents(d.amount_cents), text(d.note));
    case "reinstated":
      return join(
        text(d.mode) && isTradeStatus(text(d.mode)) ? `to ${TRADE_STATUS_ADMIN_LABELS[text(d.mode) as TradeStatus]}` : null,
        when(d.ship_by) ? `ship by ${when(d.ship_by)}` : null,
      );
    case "fault_cleared":
      return text(d.fault) ? (CUSTOMER_FAULT_LABELS[text(d.fault) as TradeCustomerFault] ?? text(d.fault)) : null;
    case "reminder_sent":
    case "staff_alerted": {
      const kind = text(d.kind);
      return kind ? (REMINDER_KINDS[kind] ?? kind.replace(/_/g, " ")) : null;
    }
    case "card_imported":
      return typeof d.quantity === "number" ? `${d.quantity} cop${d.quantity === 1 ? "y" : "ies"}` : null;
    case "handoff_changed":
      return d.to === "local" ? "to local pickup" : d.to === "ship" ? "to shipping" : null;
    case "meetup_set":
      return text(d.details);
    case "met_up":
      return join(
        typeof d.cards === "number" ? `${d.cards} card${d.cards === 1 ? "" : "s"} taken` : null,
        cents(d.final_value_cents) ? `worth ${cents(d.final_value_cents)}` : null,
        cents(d.final_credit_cents) ? `credit ${cents(d.final_credit_cents)}` : null,
        typeof d.paid_cents === "number" && d.paid_cents > 0 ? `paid ${cents(d.paid_cents)} (${text(d.payment_method) ?? "in person"})` : "nothing to pay",
        text(d.payment_note),
      );
    case "cards_reviewed":
    case "cards_inspected":
      return typeof d.cards === "number" ? `${d.cards} card${d.cards === 1 ? "" : "s"}` : null;
    case "rejected":
    case "canceled":
    case "expired":
    case "offer_expired":
    case "canceled_after_shipment":
    case "declined_after_inspection":
    case "canceled_by_store":
      return join(text(d.reason), text(d.fault) ? (CUSTOMER_FAULT_LABELS[text(d.fault) as TradeCustomerFault] ?? null) : null);
    default:
      if (e.event.startsWith("deposit_")) return join(cents(d.amount_cents), text(d.note), text(d.failure));
      return null;
  }
}

/** What a change's email to the customer came to, as a sentence to add to "Done." (or nothing). */
export function customerEmailNote(outcome: { status: "sent" | "failed" | "skipped"; reason?: string } | null | undefined): string {
  if (!outcome) return "";
  if (outcome.status === "sent") return " The customer was emailed.";
  if (outcome.status === "failed") return " The email to the customer didn't go out: let them know another way.";
  if (outcome.reason === "customer-emails-off") return " Customer emails are off (Settings), so no email went out.";
  if (outcome.reason === "stripe-not-configured") return " Stripe isn't set up, so nothing was refunded: refund it in Stripe.";
  return " No email went out to the customer.";
}

/** Who did it, as staff read it. */
export function actorLabel(e: Pick<StaffTradeEvent, "actorType" | "actorLabel">): string {
  if (e.actorType === "system") {
    if (e.actorLabel === "stripe") return "Stripe";
    if (e.actorLabel === "Stripe dashboard") return "Stripe dashboard";
    return e.actorLabel === "tracking" ? "Carrier tracking" : "Automatic";
  }
  if (e.actorType === "customer") return "Customer";
  return e.actorLabel || "Staff";
}
