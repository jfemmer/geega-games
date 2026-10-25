import { adminFetch } from "./apiClient";
import {
  ADMIN_TRADE_CENTER_API,
  type CardConditionCode,
  type StaffTrade,
  type StaffTradeSummary,
  type TradeCarrier,
  type TradeSettings,
  type TradeStatus,
  type TradeWantedInput,
} from "../../store/lib/tradeCenter";

// Admin → Trades (online trades from the storefront's Trade Cards page).
// Everything goes through /api/admin/trade-center (service role, staff only):
// the trade tables have no browser grants at all. Every change answers with
// the trade as it now stands, so the drawer never shows a stale total.

export type TradeListFilter = "waiting" | "open" | "all" | TradeStatus;

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

/** trade_settings as the Settings tab saves it. */
export interface TradeSettingsInput extends Omit<TradeSettings, "updatedAt" | "shipTo"> {
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
  list(filter: TradeListFilter, search: string): Promise<TradeListResult> {
    const params = new URLSearchParams({ view: "list", filter });
    const q = search.trim();
    if (q) params.set("q", q);
    return adminFetch<TradeListResult>(`${ADMIN_TRADE_CENTER_API}?${params.toString()}`);
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

  /** shipBy: YYYY-MM-DD (end of that day in St. Louis); omitted = the usual business days. */
  approve(tradeId: string, input: { conditions: string; shipBy?: string }) {
    return post({ action: "approve", tradeId, conditions: input.conditions, ...(input.shipBy ? { shipBy: input.shipBy } : {}) });
  },

  reject(tradeId: string, reason: string) {
    return post({ action: "reject", tradeId, reason });
  },

  extend(tradeId: string, hours: number) {
    return post({ action: "extend", tradeId, hours });
  },

  markReceived(tradeId: string) {
    return post({ action: "markReceived", tradeId });
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

  message(tradeId: string, body: string, visibleToCustomer: boolean) {
    return post({ action: "message", tradeId, body, visibleToCustomer });
  },
};
