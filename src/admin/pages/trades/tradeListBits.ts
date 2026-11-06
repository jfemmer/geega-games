import {
  HOLD_SOON_MS,
  RESERVED_STATUSES,
  formatDeadline,
  timeLeft,
  tradeComparison,
  tradeShippingTerms,
  type StaffTradeSummary,
  type TradeStatus,
} from "../../../store/lib/tradeCenter";
import { formatCents } from "../../utils/format";

// What the Trades list says about each trade beyond its status: their
// cards' value and the credit it earns, what's left to pay (or the credit
// left over), how long our cards are held for it, and where their package
// is. Everything comes from the trade row the list already loads, on the
// trade's own terms (rate, fee, shipping), so it matches the drawer.

/** Their cards' value as it stands: estimated, approved or final (a local pickup trade's: at the meetup). */
export function theirValue(t: StaffTradeSummary): { cents: number; stage: "final" | "approved" | "estimate" } | null {
  if (t.finalValueCents != null) return { cents: t.finalValueCents, stage: "final" };
  if (t.handoffMethod === "local") return null;
  if (t.approvedValueCents != null) return { cents: t.approvedValueCents, stage: "approved" };
  return { cents: t.estimatedValueCents, stage: "estimate" };
}

export interface TradeMoney {
  /** Their cards' credit at the trade's rate, after any fee (the accepted final credit once there is one). */
  creditCents: number;
  /** Paid by card at the end: our cards the credit doesn't cover, plus shipping them. */
  dueCents: number;
  /** Credit beyond our cards, kept as store credit. */
  excessCents: number;
  stage: "final" | "approved" | "estimate";
}

/** The trade's credit and balance as it stands, or null before there's a value (local pickup before the meetup). */
export function tradeMoney(t: StaffTradeSummary): TradeMoney | null {
  const v = theirValue(t);
  if (!v) return null;
  const c = tradeComparison({
    wantedCents: t.wantedTotalCents,
    offeredValueCents: v.cents,
    ratePercent: t.creditRatePercent,
    feeCents: t.processingFeeCents,
    shipping: tradeShippingTerms(t),
  });
  const creditCents = t.finalCreditCents ?? c.creditCents;
  return {
    creditCents,
    dueCents: t.amountDueCents ?? c.cashDueCents,
    excessCents: Math.max(creditCents - t.wantedTotalCents, 0),
    stage: v.stage,
  };
}

/** "$33.99 by card", "$12.00 credit left", both (shipping is always by card), or "Covered", for the Balance column. */
export function balanceLabel(m: TradeMoney): string {
  const parts = [
    ...(m.dueCents > 0 ? [`${formatCents(m.dueCents)} by card`] : []),
    ...(m.excessCents > 0 ? [`${formatCents(m.excessCents)} credit left`] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : "Covered";
}

export interface HoldLine {
  label: string;
  detail: string | null;
  /** Ends within HOLD_SOON_MS (or has passed and is waiting for the worker). */
  soon: boolean;
}

/** How our cards are held for the trade right now: a review or confirmation hold (with its end), reserved, or not at all. */
export function holdLine(t: Pick<StaffTradeSummary, "hold" | "status" | "handoffMethod" | "shipBy" | "inboundAcceptedAt">, now: number): HoldLine | null {
  if (t.hold) {
    const ends = Date.parse(t.hold.expiresAt);
    const label = t.hold.stage === "review" ? "Review hold" : "Confirmation hold";
    if (!Number.isFinite(ends)) return { label, detail: null, soon: false };
    return {
      label,
      detail: ends > now ? `${timeLeft(ends, now)} left · ends ${formatDeadline(t.hold.expiresAt)}` : "Ended: releasing",
      soon: ends - now <= HOLD_SOON_MS,
    };
  }
  if ((RESERVED_STATUSES as readonly string[]).includes(t.status)) {
    const detail =
      t.handoffMethod === "local"
        ? "Until the meetup"
        : t.inboundAcceptedAt
          ? "Shipped: until settled"
          : t.shipBy
            ? `Ship by ${formatDeadline(t.shipBy)}`
            : null;
    return { label: "Reserved", detail, soon: false };
  }
  return null;
}

const RECEIVED: ReadonlySet<TradeStatus> = new Set([
  "received",
  "under_inspection",
  "awaiting_final_approval",
  "awaiting_payment",
  "approved_for_fulfillment",
  "completed",
  "declined_after_inspection",
]);

/** Where the customer's package is, in a few words, or null when nothing is due to ship. */
export function shipmentLine(t: Pick<StaffTradeSummary, "status" | "handoffMethod" | "inboundCarrier" | "returnStatus">): string | null {
  if (t.returnStatus === "pending") return "Mail their cards back";
  if (t.returnStatus === "returned") return "Returned to them";
  if (t.handoffMethod === "local") return t.status === "completed" ? "Traded in person" : null;
  if (t.status === "awaiting_shipment") return "Not shipped yet";
  if (t.status === "tracking_submitted") return `Tracking added${t.inboundCarrier ? ` (${t.inboundCarrier})` : ""}: awaiting first scan`;
  if (t.status === "in_transit") return `In transit${t.inboundCarrier ? ` (${t.inboundCarrier})` : ""}`;
  if (t.status === "canceled_after_shipment") return "Canceled after shipping";
  if (RECEIVED.has(t.status)) return "Received";
  return null;
}
