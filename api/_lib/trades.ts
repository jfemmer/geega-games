import { siteUrl } from "./assets.js";
import {
  TRADE_PATH,
  type StaffTradeView,
  type TradeCardPrinting,
  type TradeTheirCard,
  type TradeView,
  type TradeYourCard,
} from "../../src/store/lib/trades.js";

// Trades confirmed in Admin → Trade Evaluator (public.trades; see
// supabase/migrations/20261024170000_trades.sql): reading a stored row back
// into what the customer's link page and the admin show.

export interface TradeRow {
  id: string;
  trade_number: number;
  share_token: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  credit_percent: number;
  their_cards: unknown;
  your_cards: unknown;
  their_tcg_low_cents: number;
  credit_cents: number;
  your_cards_cents: number;
  balance_cents: number;
  confirmed_by: string | null;
  confirmed_by_email: string | null;
  created_at: string;
  emailed_to: string | null;
  emailed_at: string | null;
  texted_to: string | null;
  texted_at: string | null;
}

/** The customer's link to a trade. */
export function tradeLink(shareToken: string): string {
  return `${siteUrl()}${TRADE_PATH}?t=${encodeURIComponent(shareToken)}`;
}

const int = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** A stored printing, or null for a line typed by hand (and for anything unreadable). */
function printingOf(value: unknown): TradeCardPrinting | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const scryfallId = str(o.scryfallId);
  const setCode = str(o.setCode);
  const collectorNumber = str(o.collectorNumber);
  const condition = str(o.condition);
  const finish = str(o.finish);
  if (!scryfallId || !setCode || !collectorNumber || !condition || !finish) return null;
  return { scryfallId, setName: str(o.setName), setCode, collectorNumber, condition, finish };
}

/** their_cards as stored (jsonb), read defensively. */
export function theirCardsOf(value: unknown): TradeTheirCard[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const quantity = int(o.quantity);
    const tcgLowCents = int(o.tcgLowCents);
    return quantity !== null && tcgLowCents !== null
      ? [{ name: str(o.name), quantity, tcgLowCents, printing: printingOf(o.printing) }]
      : [];
  });
}

/** your_cards as stored (jsonb), read defensively. */
export function yourCardsOf(value: unknown): TradeYourCard[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const quantity = int(o.quantity);
    const priceCents = int(o.priceCents);
    const cardName = str(o.cardName);
    if (quantity === null || priceCents === null || !cardName) return [];
    return [
      {
        cardName,
        setName: str(o.setName),
        setCode: str(o.setCode) ?? "",
        collectorNumber: str(o.collectorNumber) ?? "",
        condition: str(o.condition) ?? "",
        finish: str(o.finish) ?? "",
        variantType: str(o.variantType),
        quantity,
        priceCents,
      },
    ];
  });
}

/** What the customer's link page shows. */
export function customerTradeView(row: TradeRow): TradeView {
  return {
    tradeNumber: row.trade_number,
    createdAt: row.created_at,
    customerName: row.customer_name,
    creditPercent: row.credit_percent,
    theirCards: theirCardsOf(row.their_cards),
    yourCards: yourCardsOf(row.your_cards),
    theirTcgLowCents: row.their_tcg_low_cents,
    creditCents: row.credit_cents,
    yourCardsCents: row.your_cards_cents,
    balanceCents: row.balance_cents,
  };
}

/** What staff see: the trade, how to reach the customer, and where the link went. */
export function staffTradeView(row: TradeRow): StaffTradeView {
  return {
    ...customerTradeView(row),
    id: row.id,
    link: tradeLink(row.share_token),
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    confirmedByEmail: row.confirmed_by_email,
    emailedTo: row.emailed_to,
    emailedAt: row.emailed_at,
    textedTo: row.texted_to,
    textedAt: row.texted_at,
  };
}
