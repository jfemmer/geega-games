// The refundable reservation deposit and customer reliability (Trade
// Center). The server decides with these (api/_lib/tradeCenter.ts); admin
// Trades shows the same numbers, and the settings page previews them.
//
// The deposit protects us when a customer confirms a trade, which reserves
// our cards, and then never ships theirs. It's a band of the value of our
// cards reserved, required from a threshold up (or by hand for a trade or a
// customer, or for a customer who has abandoned reservations before). It's
// refunded in full once the carrier accepts their package in time, and it's
// never kept without staff deciding to.
//
// Pure module: no React, browser, Node or Supabase imports. Money is whole cents.

export interface DepositSettings {
  depositsEnabled: boolean;
  depositThresholdCents: number;
  depositBand1MaxCents: number;
  depositBand2MaxCents: number;
  depositBand3MaxCents: number;
  depositBand1Cents: number;
  depositBand2Cents: number;
  depositBand3Cents: number;
  depositBand4Cents: number;
}

export interface ReliabilitySettings {
  shipDaysNew: number;
  shipDaysTier1: number;
  shipDaysTier2: number;
  loyaltyTier1Trades: number;
  loyaltyTier2Trades: number;
  abandonLimit: number;
  abandonPolicy: "deposit" | "block";
}

/** The deposit band for this much of our cards (whether or not one is required). */
export function depositBandCents(wantedCents: number, s: DepositSettings): number {
  if (wantedCents < s.depositBand1MaxCents) return s.depositBand1Cents;
  if (wantedCents < s.depositBand2MaxCents) return s.depositBand2Cents;
  if (wantedCents < s.depositBand3MaxCents) return s.depositBand3Cents;
  return s.depositBand4Cents;
}

/** The bands in order, for tables: from (inclusive), up to (exclusive; null: no limit), and the deposit. */
export function depositBands(s: DepositSettings): { fromCents: number; toCents: number | null; depositCents: number }[] {
  return [
    { fromCents: 0, toCents: s.depositBand1MaxCents, depositCents: s.depositBand1Cents },
    { fromCents: s.depositBand1MaxCents, toCents: s.depositBand2MaxCents, depositCents: s.depositBand2Cents },
    { fromCents: s.depositBand2MaxCents, toCents: s.depositBand3MaxCents, depositCents: s.depositBand3Cents },
    { fromCents: s.depositBand3MaxCents, toCents: null, depositCents: s.depositBand4Cents },
  ];
}

export type DepositOverride = "auto" | "required" | "waived";
export type DepositReason = "threshold" | "trade" | "customer" | "reliability";

export const DEPOSIT_REASON_LABELS: Record<DepositReason, string> = {
  threshold: "Our cards are worth more than the deposit threshold",
  trade: "Required by staff for this trade",
  customer: "Required by staff for this customer",
  reliability: "Required after earlier reservations were abandoned",
};

export interface DepositDecision {
  cents: number;
  reason: DepositReason | null;
}

/**
 * Whether a trade needs a deposit, and how much. Waived by staff: none.
 * Otherwise required by staff for the trade or the customer, after repeated
 * abandoned reservations, or from the threshold up. Nothing at all while
 * deposits are switched off.
 */
export function depositFor(
  input: { wantedCents: number; override: DepositOverride; customerRequired: boolean; reliabilityRequired: boolean },
  s: DepositSettings,
): DepositDecision {
  if (!s.depositsEnabled || input.override === "waived" || input.wantedCents <= 0) return { cents: 0, reason: null };
  const band = depositBandCents(input.wantedCents, s);
  if (input.override === "required") return { cents: band, reason: "trade" };
  if (input.customerRequired) return { cents: band, reason: "customer" };
  if (input.reliabilityRequired) return { cents: band, reason: "reliability" };
  if (input.wantedCents >= s.depositThresholdCents) return { cents: band, reason: "threshold" };
  return { cents: 0, reason: null };
}

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------

/** A customer's record, from their trades (trade_customer_stats). */
export interface CustomerRecord {
  completedTrades: number;
  completedValueCents: number;
  /** Reservations they canceled before shipping. */
  abandonedReservations: number;
  /** Shipping deadlines missed (no shipment, or shipped late and counted). */
  missedDeadlines: number;
  /** Abandonments in the reliability window that staff haven't cleared. */
  recentFaults: number;
  onTimeShipments: number;
  lateShipments: number;
  declinedAfterInspection: number;
  canceledAfterShipment: number;
  storeCanceled: number;
  openTrades: number;
  totalTrades: number;
  extensionRequests: number;
  /** Staff require a deposit on every trade of theirs. */
  depositRequired: boolean;
  /** Staff paused new trades for them. */
  blocked: boolean;
  flagNote: string | null;
}

export const EMPTY_RECORD: CustomerRecord = {
  completedTrades: 0,
  completedValueCents: 0,
  abandonedReservations: 0,
  missedDeadlines: 0,
  recentFaults: 0,
  onTimeShipments: 0,
  lateShipments: 0,
  declinedAfterInspection: 0,
  canceledAfterShipment: 0,
  storeCanceled: 0,
  openTrades: 0,
  totalTrades: 0,
  extensionRequests: 0,
  depositRequired: false,
  blocked: false,
  flagNote: null,
};

/** trade_customer_stats' JSON as a record (missing numbers count as 0). */
export function readCustomerRecord(value: unknown): CustomerRecord {
  const o = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const n = (k: string) => {
    const v = Number(o[k]);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  };
  return {
    completedTrades: n("completed_trades"),
    completedValueCents: n("completed_value_cents"),
    abandonedReservations: n("abandoned_reservations"),
    missedDeadlines: n("missed_deadlines"),
    recentFaults: n("recent_faults"),
    onTimeShipments: n("on_time_shipments"),
    lateShipments: n("late_shipments"),
    declinedAfterInspection: n("declined_after_inspection"),
    canceledAfterShipment: n("canceled_after_shipment"),
    storeCanceled: n("store_canceled"),
    openTrades: n("open_trades"),
    totalTrades: n("total_trades"),
    extensionRequests: n("extension_requests"),
    depositRequired: o.deposit_required === true,
    blocked: o.blocked === true,
    flagNote: typeof o.flag_note === "string" && o.flag_note.trim() ? o.flag_note.trim() : null,
  };
}

/**
 * Shipped on time, out of every reservation they had to ship (on time, late,
 * or not at all), as a whole percent; null before their first.
 */
export function onTimePercent(r: Pick<CustomerRecord, "onTimeShipments" | "lateShipments" | "missedDeadlines">): number | null {
  const lateOrMissed = r.lateShipments + Math.max(r.missedDeadlines - r.lateShipments, 0);
  const total = r.onTimeShipments + lateOrMissed;
  return total === 0 ? null : Math.round((r.onTimeShipments * 100) / total);
}

export type LoyaltyTier = "new" | "tier1" | "tier2";

export interface Privileges {
  /** Qualifying days to ship once reserved. */
  shipDays: number;
  tier: LoyaltyTier;
  /** Over the abandonment limit with the deposit policy: a deposit on every trade. */
  reliabilityDeposit: boolean;
  /** No new trades: paused by staff, or over the limit with the block policy. */
  blocked: boolean;
  /** Over the abandonment limit (either policy). */
  overAbandonLimit: boolean;
}

/**
 * What a customer's record earns them. More time to ship after
 * loyaltyTier1Trades and loyaltyTier2Trades completed trades; customers over
 * the abandonment limit go back to the new-customer window and either need a
 * deposit on every trade or can't start one, as the policy says. Declining
 * after inspection, carrier delays after a timely scan, our cancellations and
 * payment problems never count: only customer-caused abandonment does.
 */
export function privilegesFor(r: CustomerRecord, s: ReliabilitySettings): Privileges {
  const overAbandonLimit = r.recentFaults >= s.abandonLimit;
  const tier: LoyaltyTier =
    r.completedTrades >= s.loyaltyTier2Trades ? "tier2" : r.completedTrades >= s.loyaltyTier1Trades ? "tier1" : "new";
  const earned = tier === "tier2" ? s.shipDaysTier2 : tier === "tier1" ? s.shipDaysTier1 : s.shipDaysNew;
  return {
    shipDays: overAbandonLimit ? s.shipDaysNew : earned,
    tier,
    reliabilityDeposit: overAbandonLimit && s.abandonPolicy === "deposit",
    blocked: r.blocked || (overAbandonLimit && s.abandonPolicy === "block"),
    overAbandonLimit,
  };
}

export const LOYALTY_TIER_LABELS: Record<LoyaltyTier, string> = {
  new: "New customer",
  tier1: "Returning customer",
  tier2: "Trusted trader",
};
