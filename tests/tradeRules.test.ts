import { describe, expect, it } from "vitest";
import {
  EMPTY_RECORD,
  depositBandCents,
  depositBands,
  depositFor,
  onTimePercent,
  privilegesFor,
  readCustomerRecord,
  type CustomerRecord,
  type DepositSettings,
  type ReliabilitySettings,
} from "../src/store/lib/tradeRules";

// The refundable reservation deposit and customer reliability (Trade Center).

const DEPOSITS: DepositSettings = {
  depositsEnabled: true,
  depositThresholdCents: 30000,
  depositBand1MaxCents: 10000,
  depositBand2MaxCents: 30000,
  depositBand3MaxCents: 60000,
  depositBand1Cents: 500,
  depositBand2Cents: 1000,
  depositBand3Cents: 2000,
  depositBand4Cents: 3000,
};

const RELIABILITY: ReliabilitySettings = {
  shipDaysNew: 3,
  shipDaysTier1: 4,
  shipDaysTier2: 5,
  loyaltyTier1Trades: 3,
  loyaltyTier2Trades: 10,
  abandonLimit: 2,
  abandonPolicy: "deposit",
};

const record = (over: Partial<CustomerRecord> = {}): CustomerRecord => ({ ...EMPTY_RECORD, ...over });
const auto = { override: "auto" as const, customerRequired: false, reliabilityRequired: false };

describe("deposit bands", () => {
  it.each([
    [1, 500],
    [9999, 500],
    [10000, 1000],
    [29999, 1000],
    [30000, 2000],
    [59999, 2000],
    [60000, 3000],
    [250000, 3000],
  ])("our cards worth %i¢ → a %i¢ band", (wanted, band) => {
    expect(depositBandCents(wanted, DEPOSITS)).toBe(band);
  });

  it("lists the bands for the Trade Cards page and settings", () => {
    expect(depositBands(DEPOSITS)).toEqual([
      { fromCents: 0, toCents: 10000, depositCents: 500 },
      { fromCents: 10000, toCents: 30000, depositCents: 1000 },
      { fromCents: 30000, toCents: 60000, depositCents: 2000 },
      { fromCents: 60000, toCents: null, depositCents: 3000 },
    ]);
  });
});

describe("whether a trade needs a deposit", () => {
  it("only from $300 of our cards by default", () => {
    expect(depositFor({ wantedCents: 29999, ...auto }, DEPOSITS)).toEqual({ cents: 0, reason: null });
    expect(depositFor({ wantedCents: 30000, ...auto }, DEPOSITS)).toEqual({ cents: 2000, reason: "threshold" });
    expect(depositFor({ wantedCents: 75000, ...auto }, DEPOSITS)).toEqual({ cents: 3000, reason: "threshold" });
  });

  it("below the threshold when staff require it, for the trade or the customer, or after abandoned reservations", () => {
    expect(depositFor({ wantedCents: 5000, ...auto, override: "required" }, DEPOSITS)).toEqual({ cents: 500, reason: "trade" });
    expect(depositFor({ wantedCents: 15000, ...auto, customerRequired: true }, DEPOSITS)).toEqual({ cents: 1000, reason: "customer" });
    expect(depositFor({ wantedCents: 15000, ...auto, reliabilityRequired: true }, DEPOSITS)).toEqual({ cents: 1000, reason: "reliability" });
  });

  it("staff waiving it beats everything; requiring it for the trade is the reason shown first", () => {
    expect(depositFor({ wantedCents: 90000, override: "waived", customerRequired: true, reliabilityRequired: true }, DEPOSITS)).toEqual({ cents: 0, reason: null });
    expect(depositFor({ wantedCents: 90000, override: "required", customerRequired: true, reliabilityRequired: true }, DEPOSITS)).toEqual({ cents: 3000, reason: "trade" });
  });

  it("never while deposits are turned off, or for a trade with nothing of ours on it", () => {
    expect(depositFor({ wantedCents: 90000, override: "required", customerRequired: true, reliabilityRequired: true }, { ...DEPOSITS, depositsEnabled: false })).toEqual({ cents: 0, reason: null });
    expect(depositFor({ wantedCents: 0, ...auto, override: "required" }, DEPOSITS)).toEqual({ cents: 0, reason: null });
  });

  it("follows the bands and threshold staff set", () => {
    const custom = { ...DEPOSITS, depositThresholdCents: 0, depositBand1Cents: 300 };
    expect(depositFor({ wantedCents: 2000, ...auto }, custom)).toEqual({ cents: 300, reason: "threshold" });
  });
});

describe("a customer's record", () => {
  it("reads the database's JSON, counting anything missing or odd as 0", () => {
    const r = readCustomerRecord({ completed_trades: 4, on_time_shipments: "3", late_shipments: -2, recent_faults: 1.7, deposit_required: true, flag_note: "  watch  " });
    expect(r).toMatchObject({ completedTrades: 4, onTimeShipments: 3, lateShipments: 0, recentFaults: 1, depositRequired: true, blocked: false, flagNote: "watch" });
    expect(readCustomerRecord(null)).toEqual(EMPTY_RECORD);
    expect(readCustomerRecord([1, 2])).toEqual(EMPTY_RECORD);
    expect(readCustomerRecord({ blocked: "yes" }).blocked).toBe(false);
  });

  it("shipped on time out of every reservation they had to ship", () => {
    expect(onTimePercent(record())).toBeNull();
    expect(onTimePercent(record({ onTimeShipments: 9, lateShipments: 1, missedDeadlines: 1 }))).toBe(90);
    // A missed deadline with no shipment at all counts too.
    expect(onTimePercent(record({ onTimeShipments: 8, lateShipments: 1, missedDeadlines: 2 }))).toBe(80);
    expect(onTimePercent(record({ missedDeadlines: 1 }))).toBe(0);
  });
});

describe("what a record earns", () => {
  it("3 days to ship for new customers, 4 after 3 completed trades, 5 after 10", () => {
    expect(privilegesFor(record(), RELIABILITY)).toMatchObject({ tier: "new", shipDays: 3, reliabilityDeposit: false, blocked: false });
    expect(privilegesFor(record({ completedTrades: 2 }), RELIABILITY)).toMatchObject({ tier: "new", shipDays: 3 });
    expect(privilegesFor(record({ completedTrades: 3 }), RELIABILITY)).toMatchObject({ tier: "tier1", shipDays: 4 });
    expect(privilegesFor(record({ completedTrades: 10 }), RELIABILITY)).toMatchObject({ tier: "tier2", shipDays: 5 });
  });

  it("over the abandonment limit: back to the new-customer window, and a deposit on every trade", () => {
    const p = privilegesFor(record({ completedTrades: 12, recentFaults: 2 }), RELIABILITY);
    expect(p).toMatchObject({ tier: "tier2", shipDays: 3, reliabilityDeposit: true, blocked: false, overAbandonLimit: true });
    expect(privilegesFor(record({ completedTrades: 12, recentFaults: 1 }), RELIABILITY)).toMatchObject({ shipDays: 5, reliabilityDeposit: false, overAbandonLimit: false });
  });

  it("with the block policy, no new trades over the limit instead", () => {
    const p = privilegesFor(record({ recentFaults: 2 }), { ...RELIABILITY, abandonPolicy: "block" });
    expect(p).toMatchObject({ blocked: true, reliabilityDeposit: false });
  });

  it("staff can pause one customer whatever their record", () => {
    expect(privilegesFor(record({ completedTrades: 20, blocked: true }), RELIABILITY).blocked).toBe(true);
  });

  it("declining after inspection, canceling after shipping and our cancellations never count against anyone", () => {
    const r = readCustomerRecord({ completed_trades: 3, declined_after_inspection: 5, canceled_after_shipment: 2, store_canceled: 4, recent_faults: 0 });
    expect(privilegesFor(r, RELIABILITY)).toMatchObject({ tier: "tier1", shipDays: 4, reliabilityDeposit: false, blocked: false });
  });
});
