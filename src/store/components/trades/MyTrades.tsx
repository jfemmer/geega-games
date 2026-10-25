import { useEffect, useState } from "react";
import { Link } from "../../lib/router";
import { formatCents } from "../../lib/money";
import { loadMyTrades } from "../../lib/tradeCenterApi";
import {
  DEPOSIT_STATUS_LABELS,
  TRADE_CENTER_PATH,
  TRADE_STATUS_LABELS,
  formatDeadline,
  isOpenTrade,
  myTradePath,
  tradeLabel,
  type CustomerTradeSummary,
} from "../../lib/tradeCenter";

// Account → Trades: the customer's trades, open ones first, each with where
// it stands, the deadline that matters right now, and the deposit when
// there is one.

function deadline(t: CustomerTradeSummary): string | null {
  switch (t.status) {
    case "awaiting_trade_list":
      return t.listDueAt ? `Send it for review by ${formatDeadline(t.listDueAt)}` : null;
    case "revision_requested":
      return t.listDueAt ? `Send your changes by ${formatDeadline(t.listDueAt)}` : null;
    case "awaiting_confirmation":
      return t.confirmBy ? `Confirm by ${formatDeadline(t.confirmBy)}` : null;
    case "awaiting_deposit":
      return t.confirmBy ? `Pay the deposit by ${formatDeadline(t.confirmBy)}` : null;
    case "awaiting_shipment":
      return t.shipBy ? `Ship your cards by ${formatDeadline(t.shipBy)}` : null;
    case "tracking_submitted":
      return "Waiting for the carrier's first scan";
    case "awaiting_final_approval":
      return "Your final offer is waiting for you";
    case "awaiting_payment":
      return t.paymentDueAt ? `Payment due ${formatDeadline(t.paymentDueAt)}` : null;
    default:
      return null;
  }
}

/** The deposit, when it's worth a mention in the list. */
function depositNote(t: CustomerTradeSummary): string | null {
  if (t.depositStatus === "not_required" || t.depositStatus === "canceled") return null;
  if (t.depositStatus === "payment_pending") {
    // Not asked for yet: said up front so confirming holds no surprise.
    if (t.status === "awaiting_confirmation") return `Refundable deposit of ${formatCents(t.depositCents)} when you confirm`;
    if (t.status !== "awaiting_deposit") return null;
  }
  return `Deposit ${formatCents(t.depositCents)}: ${DEPOSIT_STATUS_LABELS[t.depositStatus].toLowerCase()}`;
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
        const deposit = depositNote(t);
        return (
          <Link key={t.id} to={myTradePath(t.id)} className="gg-orderrow gg-tc-tradeRow">
            <span className="gg-tc-tradeRow__main">
              <strong>{tradeLabel(t.tradeNumber)}</strong>{" "}
              <span className="gg-card-meta">{new Date(t.createdAt).toLocaleDateString()}</span>
              <span className="gg-card-meta">
                {t.wantedCount} of our card{t.wantedCount === 1 ? "" : "s"} ({formatCents(t.wantedTotalCents)}) · {t.offeredCount} of yours
              </span>
              {due && <span className="gg-tc-tradeRow__due">{due}</span>}
              {deposit && <span className="gg-card-meta">{deposit}</span>}
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
