import type { ReactNode } from "react";
import { formatCents } from "../../lib/money";
import { TRADE_FREE_SHIPPING_FROM_CENTS, tradeComparison } from "../../lib/tradeCenter";

// The running total on every trade screen: our cards and shipping on one
// side, the customer's cards and their trade credit on the other, and the
// bottom line: what's left to pay by card, or the credit left over. The bar
// shows how much of our cards the credit covers, so a customer can see at a
// glance whether to add more cards.

export function TradeBalance({
  wantedCents,
  offeredValueCents,
  valueLabel,
  ratePercent,
  feeCents = 0,
  shippingCents,
  title = "Your trade",
  excessLabel = "Kept as store credit for your next order",
  footnote,
  children,
}: {
  wantedCents: number;
  offeredValueCents: number;
  /** What the customer's cards are worth here: "estimated", "approved" or "final". */
  valueLabel: string;
  ratePercent: number;
  feeCents?: number;
  /** Defaults to what checkout would charge. */
  shippingCents?: number;
  title?: string;
  excessLabel?: string;
  footnote?: ReactNode;
  children?: ReactNode;
}) {
  const c = tradeComparison({ wantedCents, offeredValueCents, ratePercent, feeCents, shippingCents });
  const due = c.wantedCents + c.shippingCents;
  const covered = due > 0 ? Math.min(c.creditCents / due, 1) : c.creditCents > 0 ? 1 : 0;
  const percent = Math.round(covered * 100);
  return (
    <section className="gg-tc-balance" aria-label={title}>
      <h2 className="gg-tc-balance__title">{title}</h2>
      {due > 0 && (
        <div className="gg-tc-meter">
          <div
            className="gg-tc-meter__track"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="How much of our cards your trade credit covers"
          >
            <span className="gg-tc-meter__fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="gg-tc-meter__label">
            {c.excessCents > 0
              ? "Your credit covers everything"
              : percent === 0
                ? "Add your cards to see how much they cover"
                : `Your credit covers ${percent}% of our cards and shipping`}
          </p>
        </div>
      )}
      <dl className="gg-tc-balance__rows">
        <div>
          <dt>Our cards</dt>
          <dd>{formatCents(c.wantedCents)}</dd>
        </div>
        <div>
          <dt>
            Shipping to you
            {c.shippingCents > 0 && <span className="gg-tc-balance__hint">Free from {formatCents(TRADE_FREE_SHIPPING_FROM_CENTS)}</span>}
          </dt>
          <dd>{c.shippingCents === 0 ? (c.wantedCents > 0 ? "Free" : formatCents(0)) : formatCents(c.shippingCents)}</dd>
        </div>
        <div>
          <dt>Your cards ({valueLabel})</dt>
          <dd>{formatCents(c.offeredValueCents)}</dd>
        </div>
        <div className="gg-tc-balance__credit">
          <dt>Trade credit at {ratePercent}%</dt>
          <dd>{formatCents(c.creditCents)}</dd>
        </div>
        {feeCents > 0 && (
          <div>
            <dt>Processing fee (taken from the credit)</dt>
            <dd>{formatCents(feeCents)}</dd>
          </div>
        )}
      </dl>
      <div className={c.remainingCents > 0 ? "gg-tc-balance__total" : "gg-tc-balance__total gg-tc-balance__total--credit"}>
        <span>{c.remainingCents > 0 ? "You'd pay by card" : "Credit left over"}</span>
        <strong>{formatCents(c.remainingCents > 0 ? c.remainingCents : c.excessCents)}</strong>
      </div>
      {c.remainingCents > 0 && c.moreValueNeededCents > 0 && c.offeredValueCents > 0 && (
        <p className="gg-tc-balance__hint gg-tc-balance__more">
          About {formatCents(c.moreValueNeededCents)} more in cards would cover it all, or pay the rest by card at the end.
        </p>
      )}
      {c.excessCents > 0 && <p className="gg-tc-balance__hint gg-tc-balance__more">{excessLabel}</p>}
      {footnote && <p className="gg-tc-balance__foot">{footnote}</p>}
      {children}
    </section>
  );
}
