// Admin → Trade Evaluator: confirming a trade, sending its link, and the
// recent trades list, through the staff-guarded /api/admin/trades endpoint.
// The server works out every price and total itself (see api/admin/trades.ts):
// the shop's cards go up as inventory ids and quantities, with the price
// staff were shown so a changed website price stops the trade.

import { adminFetch } from "./apiClient";
import type { StaffTradeView, TradeTheirCard } from "../../store/lib/trades";

const PATH = "/api/admin/trades";

export interface ConfirmTradeInput {
  customer: { name: string; phone: string | null; email: string | null };
  creditPercent: number;
  theirs: TradeTheirCard[];
  /** priceCents: the regular website price the page showed for the card. */
  yours: { inventoryItemId: string; quantity: number; priceCents: number }[];
}

type TradeResponse = { trade: StaffTradeView };

export const tradeRepository = {
  async recent(): Promise<StaffTradeView[]> {
    return (await adminFetch<{ trades: StaffTradeView[] }>(PATH, { method: "GET" })).trades;
  },

  async confirm(input: ConfirmTradeInput): Promise<StaffTradeView> {
    return (await adminFetch<TradeResponse>(PATH, { method: "POST", body: { action: "confirm", ...input } })).trade;
  },

  /** Emails the trade's link; resolves with the trade as it now stands. */
  async email(tradeId: string, email: string): Promise<StaffTradeView> {
    return (await adminFetch<TradeResponse>(PATH, { method: "POST", body: { action: "email", tradeId, email } })).trade;
  },

  /** Notes that the link was texted (from this phone) to `phone`. */
  async texted(tradeId: string, phone: string): Promise<StaffTradeView> {
    return (await adminFetch<TradeResponse>(PATH, { method: "POST", body: { action: "texted", tradeId, phone } })).trade;
  },
};
