import { adminFetch } from "./apiClient";
import {
  ADMIN_TRADE_CENTER_API,
  type CardConditionCode,
  type DepositStatus,
  type StaffTrade,
  type StaffTradeSummary,
  type TradeCarrier,
  type TradeSettings,
  type TradeStatus,
  type TradeWantedInput,
} from "../../store/lib/tradeCenter";
import type { CustomerRecord, DepositOverride, Privileges } from "../../store/lib/tradeRules";
import type { EconomicsTotals, TradeEconomics } from "../../store/lib/tradeEconomics";

// Admin → Trades (online trades from the storefront's Trade Cards page).
// Everything goes through /api/admin/trade-center (service role, staff only):
// the trade tables have no browser grants at all. Every change answers with
// the trade as it now stands, so the drawer never shows a stale total.

/** The list's filters, or one status. None is named after a status: their counts share one object. */
export type TradeListFilter = "waiting" | "open" | "all" | "deposits" | "reserved" | "abandoned" | "finished" | TradeStatus;

/** One of our cards held for a trade right now (Reserved tab). */
export interface ReservedLine {
  itemId: string;
  tradeId: string;
  tradeNumber: number;
  status: TradeStatus;
  customerName: string | null;
  customerEmail: string | null;
  shipBy: string | null;
  /** When the carrier accepted their package (null: not yet). */
  shippedAt: string | null;
  depositStatus: DepositStatus;
  inventoryItemId: string | null;
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
  condition: string;
  finish: string;
  quantity: number;
  unitPriceCents: number;
  imageUrl: string | null;
}

/** A customer who has traded, with their record and what it earns them (Customers tab). */
export interface TradeCustomerRow {
  userId: string;
  name: string | null;
  email: string | null;
  lastTradeAt: string | null;
  record: CustomerRecord;
  privileges: Privileges;
}

/** Deposits at a glance (Deposits tab), in cents. */
export interface DepositTotals {
  heldCents: number;
  refundPendingCents: number;
  refundedCents: number;
  reviewCents: number;
  forfeitedCents: number;
  failedCents: number;
  /** Stripe's processing fees on deposits (absorbed by the store, never taken from refunds). */
  feesCents: number;
  awaitingPaymentCents: number;
}

/** A finished trade's effect on inventory value, with shipping (Economics tab; theoretical, not profit). */
export interface EconomicsTrade {
  id: string;
  tradeNumber: number;
  status: TradeStatus;
  customerName: string | null;
  customerEmail: string | null;
  paidAt: string | null;
  creditRatePercent: number;
  economics: TradeEconomics;
}

export type EconomicsPeriod = 30 | 90 | 365 | null;

export interface EconomicsResult {
  /** The window in days; null for all time. */
  days: EconomicsPeriod;
  totals: EconomicsTotals;
  /** The latest finished trades in the window (up to 100). */
  trades: EconomicsTrade[];
  /** Too many trades to count them all: the oldest were left out. */
  truncated?: boolean;
  settings: TradeSettings;
  owner: boolean;
}

export interface TradeListResult {
  trades: StaffTradeSummary[];
  /** Per status, plus waiting (on staff), open and all. */
  counts: Record<string, number>;
  settings: TradeSettings;
  /** The signed-in staff member is the store owner (role admin). */
  owner: boolean;
}

export interface TradeDetailResult {
  trade: StaffTrade;
  settings: TradeSettings;
  owner: boolean;
  /** The email this change sends the customer, if it sends one: sent, failed, or skipped (and why). */
  customerEmail?: { status: "sent" | "failed" | "skipped"; reason?: string } | null;
}

export interface TradeSettingsResult {
  settings: TradeSettings;
  owner: boolean;
}

/** One of the customer's cards, as staff decide on it before approval. */
export interface ReviewCardInput {
  id: string;
  reviewStatus: "pending" | "approved" | "rejected";
  approvedQuantity: number | null;
  approvedUnitCents: number | null;
  /** For the customer. */
  reviewNote?: string | null;
  /** Staff only. */
  internalNote?: string | null;
}

export type TradeAuthenticity = "unchecked" | "authentic" | "counterfeit" | "unsure";
export type TradeCardFlag = "damaged" | "counterfeit" | "incorrect" | "missing";

/** One of the customer's cards, as staff find it when the package arrives. */
export interface InspectCardInput {
  id: string;
  receivedQuantity: number;
  authenticity: TradeAuthenticity;
  verifiedCondition: CardConditionCode | null;
  finalQuantity: number;
  finalUnitCents: number;
  flags: TradeCardFlag[];
  /** For the customer. */
  inspectionNote?: string | null;
  /** Staff only. */
  inspectionInternalNote?: string | null;
}

/** trade_settings as the Settings tab saves it (the terms version is the server's). */
export interface TradeSettingsInput extends Omit<TradeSettings, "updatedAt" | "shipTo" | "depositTermsVersion"> {
  shipTo: {
    name: string | null;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
  } | null;
}

function post(body: Record<string, unknown>): Promise<TradeDetailResult> {
  return adminFetch<TradeDetailResult>(ADMIN_TRADE_CENTER_API, { method: "POST", body });
}

export const tradeCenterRepository = {
  list(filter: TradeListFilter, search: string, deposit: DepositStatus | null = null): Promise<TradeListResult> {
    const params = new URLSearchParams({ view: "list", filter });
    const q = search.trim();
    if (q) params.set("q", q);
    if (deposit) params.set("deposit", deposit);
    return adminFetch<TradeListResult>(`${ADMIN_TRADE_CENTER_API}?${params.toString()}`);
  },

  reserved(): Promise<{ lines: ReservedLine[]; settings: TradeSettings; owner: boolean }> {
    return adminFetch(`${ADMIN_TRADE_CENTER_API}?view=reserved`);
  },

  customers(): Promise<{ customers: TradeCustomerRow[]; settings: TradeSettings; owner: boolean }> {
    return adminFetch(`${ADMIN_TRADE_CENTER_API}?view=customers`);
  },

  deposits(): Promise<{ totals: DepositTotals; trades: StaffTradeSummary[]; settings: TradeSettings; owner: boolean }> {
    return adminFetch(`${ADMIN_TRADE_CENTER_API}?view=deposits`);
  },

  /** Finished trades over the last `days` days (null: all time). */
  economics(days: EconomicsPeriod): Promise<EconomicsResult> {
    const params = new URLSearchParams({ view: "economics" });
    if (days !== null) params.set("days", String(days));
    return adminFetch(`${ADMIN_TRADE_CENTER_API}?${params.toString()}`);
  },

  /** Owner: a deposit on every trade of theirs, or no new trades for now. */
  setCustomerFlags(
    userId: string,
    input: { depositRequired: boolean; blocked: boolean; note: string },
  ): Promise<{ customers: TradeCustomerRow[]; userId: string; settings: TradeSettings; owner: boolean }> {
    return adminFetch(ADMIN_TRADE_CENTER_API, { method: "POST", body: { action: "setCustomerFlags", userId, ...input } });
  },

  get(tradeId: string): Promise<TradeDetailResult> {
    return adminFetch<TradeDetailResult>(`${ADMIN_TRADE_CENTER_API}?id=${encodeURIComponent(tradeId)}`);
  },

  settings(): Promise<TradeSettingsResult> {
    return adminFetch<TradeSettingsResult>(`${ADMIN_TRADE_CENTER_API}?view=settings`);
  },

  saveSettings(settings: TradeSettingsInput): Promise<TradeSettingsResult> {
    return adminFetch<TradeSettingsResult>(ADMIN_TRADE_CENTER_API, {
      method: "POST",
      body: { action: "saveSettings", settings },
    });
  },

  review(tradeId: string, cards: ReviewCardInput[]) {
    return post({ action: "review", tradeId, cards });
  },

  requestRevision(tradeId: string, message: string) {
    return post({ action: "requestRevision", tradeId, message });
  },

  /** The customer then has the confirmation window to confirm; the deposit follows the settings unless overridden. */
  approve(tradeId: string, input: { conditions: string; depositOverride?: DepositOverride }) {
    return post({ action: "approve", tradeId, conditions: input.conditions, ...(input.depositOverride ? { depositOverride: input.depositOverride } : {}) });
  },

  /** Before the trade is confirmed (nothing held, nothing paid). */
  reject(tradeId: string, reason: string) {
    return post({ action: "reject", tradeId, reason });
  },

  /** Before the deposit is paid. */
  setDeposit(tradeId: string, override: DepositOverride) {
    return post({ action: "setDeposit", tradeId, override });
  },

  extend(tradeId: string, input: { kind: "list" | "confirmation" | "shipping" | "payment"; hours: number; customerRequested: boolean; reason: string }) {
    return post({ action: "extend", tradeId, ...input });
  },

  /** The carrier accepted their package at acceptedAt; on time refunds the deposit, late sends it to review unless refund. */
  verifyShipment(tradeId: string, input: { acceptedAt: string; onTime: boolean; refund: boolean; note: string }) {
    return post({ action: "verifyShipment", tradeId, ...input });
  },

  markReceived(tradeId: string) {
    return post({ action: "markReceived", tradeId });
  },

  /** A package that arrived for a reservation that already expired. */
  cardsArrived(tradeId: string) {
    return post({ action: "cardsArrived", tradeId });
  },

  reinstate(
    tradeId: string,
    input: { mode: "awaiting_shipment" | "in_transit" | "received"; shipDays?: number; acceptedAt?: string; clearFault: boolean },
  ) {
    return post({ action: "reinstate", tradeId, ...input });
  },

  /** Release a reservation that wasn't shipped, before the worker would. */
  expireNow(tradeId: string, input: { reason: string; countAgainst: boolean }) {
    return post({ action: "expireNow", tradeId, ...input });
  },

  /** A confirmed trade: any deposit is refunded in full and cards that reached us go back. */
  cancelByStore(tradeId: string, reason: string) {
    return post({ action: "cancelByStore", tradeId, reason });
  },

  refundDeposit(tradeId: string, note: string) {
    return post({ action: "refundDeposit", tradeId, note });
  },

  /** Owner, with keeping deposits turned on in Settings; the note is shown to the customer. */
  forfeitDeposit(tradeId: string, note: string) {
    return post({ action: "forfeitDeposit", tradeId, note });
  },

  retryRefund(tradeId: string) {
    return post({ action: "retryRefund", tradeId });
  },

  resolveDispute(tradeId: string, disputeId: string, outcome: "accepted" | "rejected", note: string) {
    return post({ action: "resolveDispute", tradeId, disputeId, outcome, note });
  },

  /** Owner: this trade no longer counts against the customer. */
  clearFault(tradeId: string) {
    return post({ action: "clearFault", tradeId });
  },

  inspect(tradeId: string, cards: InspectCardInput[]) {
    return post({ action: "inspect", tradeId, cards });
  },

  confirmAsDescribed(tradeId: string) {
    return post({ action: "confirmAsDescribed", tradeId });
  },

  sendFinalOffer(tradeId: string, cashForExcess: boolean) {
    return post({ action: "sendFinalOffer", tradeId, cashForExcess });
  },

  reopenInspection(tradeId: string) {
    return post({ action: "reopenInspection", tradeId });
  },

  setWanted(tradeId: string, items: TradeWantedInput[]) {
    return post({ action: "setWanted", tradeId, items });
  },

  markReturned(tradeId: string, input: { carrier: TradeCarrier | null; trackingNumber: string }) {
    return post({ action: "markReturned", tradeId, carrier: input.carrier, trackingNumber: input.trackingNumber });
  },

  importCard(offerCardId: string, priceCents: number, storageLocation: string) {
    return post({ action: "importCard", offerCardId, priceCents, storageLocation });
  },

  recordPayment(tradeId: string, note: string) {
    return post({ action: "recordPayment", tradeId, note });
  },

  markCashPaid(tradeId: string, note: string) {
    return post({ action: "markCashPaid", tradeId, note });
  },

  /** What shipping our cards cost, when the label wasn't bought through EasyPost (finished trades); null clears it. */
  setPostage(tradeId: string, postageCents: number | null) {
    return post({ action: "setPostage", tradeId, postageCents });
  },

  message(tradeId: string, body: string, visibleToCustomer: boolean) {
    return post({ action: "message", tradeId, body, visibleToCustomer });
  },
};
