import { formatCents } from "../../lib/money";
import { DEPOSIT_STATUS_LABELS, formatDeadline, type CustomerTrade } from "../../lib/tradeCenter";

// The refundable reservation deposit on a trade, wherever the trade stands:
// what it is, where it is, and what happens to it next. Shown beside the
// shipping or inspection status, never instead of it.

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
}

export function TradeDepositCard({ trade }: { trade: CustomerTrade }) {
  const d = trade.deposit;
  if (d.status === "not_required" || (d.cents === 0 && d.paidCents === null)) return null;
  const amount = formatCents(d.paidCents ?? d.cents);
  let body: string;
  switch (d.status) {
    case "payment_pending":
      body = "Due when you confirm. Nothing is reserved until it's paid, and it's refunded in full once the carrier accepts your package in time.";
      break;
    case "paid":
      body = trade.shipBy
        ? `Refunded in full once the carrier accepts your package by ${formatDeadline(trade.shipBy)}. You never lose it for declining an offer after your cards arrive.`
        : "Refunded in full once the carrier accepts your package in time.";
      break;
    case "refund_pending":
      body = `Refund started${d.refundRequestedAt ? ` ${shortDate(d.refundRequestedAt)}` : ""}. Your bank may take 5 to 10 business days to show it.`;
      break;
    case "refunded":
      body = `Refunded in full${d.refundedAt ? ` on ${shortDate(d.refundedAt)}` : ""}, to the card you paid with.`;
      break;
    case "forfeiture_review":
      body = "A person reviews every case under the terms you agreed to before any deposit is kept. We'll email you either way.";
      break;
    case "forfeited":
      body = "Kept under the cancellation terms you agreed to. Questions? Reply to our email or send us a message here.";
      break;
    case "refund_failed":
      body = "Your card's bank couldn't take the refund. We're on it and will be in touch to get it to you another way.";
      break;
    case "canceled":
      body = "This trade closed before the deposit was paid, so nothing was charged.";
      break;
    default:
      body = "";
  }
  const tone = d.status === "refunded" ? "ok" : d.status === "forfeited" || d.status === "refund_failed" ? "warn" : "info";
  return (
    <section className={`gg-tc-deposit gg-tc-deposit--${tone}`} aria-labelledby="gg-tc-deposit-title">
      <div className="gg-tc-deposit__head">
        <h2 id="gg-tc-deposit-title">Refundable deposit</h2>
        <span className="gg-tc-deposit__amount">{amount}</span>
      </div>
      <p className="gg-tc-deposit__status">{DEPOSIT_STATUS_LABELS[d.status]}</p>
      <p className="gg-tc-deposit__body">{body}</p>
    </section>
  );
}
