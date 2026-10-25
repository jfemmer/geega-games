import type { BadgeTone } from "../../utils/labels";
import {
  STAFF_WAITING_STATUSES,
  formatUsd,
  type StaffTradeEvent,
  type TradeStatus,
} from "../../../store/lib/tradeCenter";

// Admin wording for online trades: badge colors, history entries and the
// money in an event's detail. Status names themselves are shared with the
// server (TRADE_STATUS_ADMIN_LABELS in src/store/lib/tradeCenter.ts).

/** Gold: waiting on you. Purple: waiting on the customer or the mail. */
export const TRADE_STATUS_TONE: Record<TradeStatus, BadgeTone> = {
  awaiting_trade_list: "neutral",
  pending_review: "gold",
  revision_requested: "neutral",
  awaiting_shipment: "purple",
  in_transit: "purple",
  received: "gold",
  under_inspection: "gold",
  awaiting_final_approval: "purple",
  awaiting_payment: "purple",
  approved_for_fulfillment: "info",
  completed: "success",
  rejected: "danger",
  canceled: "neutral",
  expired: "neutral",
  return_pending: "gold",
  returned: "neutral",
};

export function waitingOnStaff(status: TradeStatus): boolean {
  return STAFF_WAITING_STATUSES.includes(status);
}

/** History, as staff read it (every event, including staff-only ones). */
const EVENT_LABELS: Record<string, string> = {
  started: "Trade started; our cards held",
  wanted_changed: "Our cards on the trade changed",
  submitted: "Customer sent their list",
  resubmitted: "Customer sent their changes",
  cards_reviewed: "Cards reviewed",
  revision_requested: "Asked the customer for changes",
  approved: "Preliminarily approved",
  tracking_added: "Customer added tracking",
  received: "Package received",
  cards_inspected: "Cards inspected",
  final_offer_sent: "Final offer sent",
  final_offer_withdrawn: "Final offer taken back to revise",
  adjustment_requested: "Customer asked for an adjustment",
  final_accepted: "Customer accepted the final offer",
  paid: "Payment received",
  finalized: "Trade finished; order created",
  completed: "Order shipped; trade complete",
  canceled: "Canceled",
  rejected: "Rejected",
  expired: "Expired",
  return_pending: "Cards to be mailed back",
  returned: "Cards mailed back",
  hold_extended: "Deadline extended",
  card_imported: "Card added to inventory",
  cash_paid: "Cash paid out",
  reminder_sent: "Reminder emailed to the customer",
  staff_alerted: "Staff alerted",
};

const REMINDER_KINDS: Record<string, string> = {
  list_due: "send their list",
  revision_due: "send their changes",
  ship_by: "ship their cards",
  payment_due: "pay",
  payment_overdue: "payment overdue",
  transit_overdue: "package still in transit",
};

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event.replace(/_/g, " ");
}

function cents(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? formatUsd(value) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The useful part of an event's detail, in a short line (or null). */
export function eventDetail(e: StaffTradeEvent): string | null {
  const d = e.detail;
  switch (e.event) {
    case "approved": {
      const value = cents(d.approved_value_cents);
      const conditions = text(d.conditions);
      return [value ? `Approved value ${value}` : null, conditions ? `Conditions: ${conditions}` : null].filter(Boolean).join(" · ") || null;
    }
    case "final_offer_sent": {
      const parts = [
        cents(d.final_value_cents) ? `Value ${cents(d.final_value_cents)}` : null,
        cents(d.final_credit_cents) ? `credit ${cents(d.final_credit_cents)}` : null,
        typeof d.cash_payout_cents === "number" && d.cash_payout_cents > 0 ? `cash ${cents(d.cash_payout_cents)}` : null,
      ];
      return parts.filter(Boolean).join(", ") || null;
    }
    case "paid": {
      const amount = cents(d.amount_cents);
      const note = text(d.note);
      return [amount, note].filter(Boolean).join(" · ") || null;
    }
    case "cash_paid": {
      const amount = cents(d.amount_cents);
      const note = text(d.note);
      return [amount, note].filter(Boolean).join(" · ") || null;
    }
    case "tracking_added":
    case "returned": {
      const carrier = text(d.carrier);
      const tracking = text(d.tracking);
      return [carrier, tracking].filter(Boolean).join(" ") || null;
    }
    case "hold_extended":
      return typeof d.hours === "number" ? `${d.hours} more hour${d.hours === 1 ? "" : "s"}` : null;
    case "reminder_sent":
    case "staff_alerted": {
      const kind = text(d.kind);
      return kind ? (REMINDER_KINDS[kind] ?? kind.replace(/_/g, " ")) : null;
    }
    case "card_imported":
      return typeof d.quantity === "number" ? `${d.quantity} cop${d.quantity === 1 ? "y" : "ies"}` : null;
    case "cards_reviewed":
    case "cards_inspected":
      return typeof d.cards === "number" ? `${d.cards} card${d.cards === 1 ? "" : "s"}` : null;
    case "rejected":
    case "canceled":
    case "expired":
    case "return_pending":
      return text(d.reason);
    default:
      return null;
  }
}

/** What a change's email to the customer came to, as a sentence to add to "Done." (or nothing). */
export function customerEmailNote(outcome: { status: "sent" | "failed" | "skipped"; reason?: string } | null | undefined): string {
  if (!outcome) return "";
  if (outcome.status === "sent") return " The customer was emailed.";
  if (outcome.status === "failed") return " The email to the customer didn't go out: let them know another way.";
  if (outcome.reason === "customer-emails-off") return " Customer emails are off (Settings), so no email went out.";
  return " No email went out to the customer.";
}

/** Who did it, as staff read it. */
export function actorLabel(e: Pick<StaffTradeEvent, "actorType" | "actorLabel">): string {
  if (e.actorType === "system") return "Automatic";
  if (e.actorType === "customer") return "Customer";
  return e.actorLabel || "Staff";
}
