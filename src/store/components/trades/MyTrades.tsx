import { useEffect, useState } from "react";
import { Link } from "../../lib/router";
import { formatCents } from "../../lib/money";
import { loadMyTrades } from "../../lib/tradeCenterApi";
import {
  TRADE_CENTER_PATH,
  TRADE_STATUS_LABELS,
  formatDeadline,
  isOpenTrade,
  myTradePath,
  tradeLabel,
  type CustomerTradeSummary,
} from "../../lib/tradeCenter";

// Account → Trades: the customer's trades, open ones first, each with where
// it stands and the deadline that matters right now.

function deadline(t: CustomerTradeSummary): string | null {
  if ((t.status === "awaiting_trade_list" || t.status === "revision_requested") && t.holdExpiresAt) {
    return `Send your list by ${formatDeadline(t.holdExpiresAt)}`;
  }
  if (t.status === "awaiting_shipment" && t.shipBy) return `Mail your cards by ${formatDeadline(t.shipBy)}`;
  if (t.status === "awaiting_payment" && t.paymentDueAt) return `Payment due ${formatDeadline(t.paymentDueAt)}`;
  if (t.status === "awaiting_final_approval") return "Your final offer is waiting for you";
  return null;
}

export default function MyTrades() {
  const [trades, setTrades] = useState<CustomerTradeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMyTrades()
      .then((res) => {
        if (!cancelled) setTrades(res.trades);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "We couldn't load your trades.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="gg-alert gg-alert-error" role="alert">
        {error}
      </div>
    );
  }
  if (!trades) return <p>Loading your trades…</p>;
  if (trades.length === 0) {
    return (
      <div className="gg-empty">
        <p>You haven&rsquo;t started a trade yet.</p>
        <Link to={TRADE_CENTER_PATH} className="gg-btn gg-btn-ghost">
          How trading works
        </Link>
      </div>
    );
  }

  const sorted = [...trades].sort((a, b) => Number(isOpenTrade(b.status)) - Number(isOpenTrade(a.status)));
  return (
    <div className="gg-tc-mytrades">
      {sorted.map((t) => {
        const due = deadline(t);
        return (
          <Link key={t.id} to={myTradePath(t.id)} className="gg-orderrow gg-tc-tradeRow">
            <span className="gg-tc-tradeRow__main">
              <strong>{tradeLabel(t.tradeNumber)}</strong>{" "}
              <span className="gg-card-meta">{new Date(t.createdAt).toLocaleDateString()}</span>
              <span className="gg-card-meta">
                {t.wantedCount} of our card{t.wantedCount === 1 ? "" : "s"} ({formatCents(t.wantedTotalCents)}) · {t.offeredCount} of yours
              </span>
              {due && <span className="gg-tc-tradeRow__due">{due}</span>}
            </span>
            <span className={`gg-tc-status gg-tc-status--${isOpenTrade(t.status) ? "open" : "closed"}`}>{TRADE_STATUS_LABELS[t.status]}</span>
          </Link>
        );
      })}
      <p className="gg-tc-line__meta">
        <Link to={TRADE_CENTER_PATH}>Start another trade</Link>
      </p>
    </div>
  );
}
