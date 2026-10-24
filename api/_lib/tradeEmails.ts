import * as React from "react";
import { sendTrackedEmail, type SendEmailResult } from "./emailService.js";
import { ServerEnv } from "./env.js";
import { logoUrl, siteUrl } from "./assets.js";
import { tradeLink, type TradeRow } from "./trades.js";
import { TradeSummary, tradeSummarySubject, tradeSummaryText, type TradeSummaryEmailData } from "./emails/TradeSummary.js";

/**
 * Emails a confirmed trade's totals and link to `to`. Sending the same trade
 * to the same address twice in one minute (a double tap) sends it once;
 * after that it can be sent again.
 */
export async function sendTradeSummaryEmail(trade: TradeRow, to: string, now = new Date()): Promise<SendEmailResult> {
  const data: TradeSummaryEmailData = {
    customerName: trade.customer_name,
    tradeNumber: trade.trade_number,
    creditPercent: trade.credit_percent,
    theirTcgLowCents: trade.their_tcg_low_cents,
    creditCents: trade.credit_cents,
    yourCardsCents: trade.your_cards_cents,
    balanceCents: trade.balance_cents,
    tradeUrl: tradeLink(trade.share_token),
    siteUrl: siteUrl(),
    logoUrl: logoUrl(),
    supportEmail: ServerEnv.replyTo(),
  };
  return sendTrackedEmail({
    emailType: "trade_summary",
    idempotencyKey: `trade-summary-${trade.id}-${to}-${Math.floor(now.getTime() / 60_000)}`,
    to,
    from: ServerEnv.fromOrders(),
    replyTo: ServerEnv.replyTo(),
    subject: tradeSummarySubject(data),
    react: React.createElement(TradeSummary, data),
    text: tradeSummaryText(data),
  });
}
