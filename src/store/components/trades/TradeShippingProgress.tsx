import type { ReactNode } from "react";
import { formatCents } from "../../lib/money";
import { moneyShort, tradeProgress, type ShippingTerms } from "../../lib/tradeShipping";

// How a selection of our cards stands against the trade minimum and free
// shipping, as the customer picks: "Add $25 more to start your trade!", then
// "You’re $100 away from FREE shipping!", then "Your trade qualifies for FREE
// tracked shipping!". It's about shipping OUR cards to them (paid by card at
// the end); shipping theirs to us is separate, and the full version says so.
// Recalculates on every render, so it follows the cart or the trade as cards
// are added, removed or change quantity. While the customer shops it can
// also say how much of their cards, at TCG low, it takes to cover ours.

export function TradeShippingProgress({
  wantedCents,
  terms,
  compact = false,
  hideFee = false,
  need,
  action,
}: {
  /** Our cards, at their trade (retail) prices. */
  wantedCents: number;
  terms: ShippingTerms & { minTradeValueCents: number };
  /** One line and the bar (card pages); the full version adds the scale and the fee. */
  compact?: boolean;
  /** Compact: leave out the shipping fee (where it's shown beside the bar already, as in the trade summary). */
  hideFee?: boolean;
  /** Under the bar: the customer's cards, at TCG low, it takes to cover ours at the trade rate. */
  need?: { valueCents: number; ratePercent: number };
  /** Shown beside the message (a link to the trade, on card pages). */
  action?: ReactNode;
}) {
  const p = tradeProgress(wantedCents, terms);
  const fee =
    p.shippingCents === 0 ? (wantedCents > 0 ? "FREE" : moneyShort(0)) : moneyShort(p.shippingCents);
  const freeFrom = terms.freeShipFeeCents > 0 ? `${moneyShort(terms.freeShipFeeCents)} from ${moneyShort(p.thresholdCents)}` : `free from ${moneyShort(p.thresholdCents)}`;
  // The minimum's label sits under its mark unless that would crowd the end label.
  const labelAtMark = p.minimumPercent >= 18 && p.minimumPercent <= 62;
  const showMark = p.minimumCents > 0 && p.minimumPercent > 0 && p.minimumPercent < 100;

  return (
    <div className={`gg-tc-progress gg-tc-progress--${p.stage}${compact ? " gg-tc-progress--compact" : ""}`}>
      <div className="gg-tc-progress__head">
        <p className="gg-tc-progress__message" aria-live="polite">
          {p.stage === "qualified" && (
            <svg className="gg-tc-progress__check" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 8.5l3.2 3L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {p.message}
        </p>
        {compact && !hideFee ? (
          <span className="gg-tc-progress__fee-inline">
            Shipping: <strong>{fee}</strong>
          </span>
        ) : null}
        {action}
      </div>
      <div
        className="gg-tc-progress__track"
        role="progressbar"
        aria-label="Our cards toward free shipping"
        aria-valuemin={0}
        aria-valuemax={p.thresholdCents / 100}
        aria-valuenow={Math.min(wantedCents, p.thresholdCents) / 100}
        aria-valuetext={`${moneyShort(wantedCents)} of our cards. ${p.message}`}
      >
        <span className="gg-tc-progress__fill" style={{ width: `${p.percent}%` }} />
        {showMark && (
          <span
            className={p.minimumMet ? "gg-tc-progress__mark gg-tc-progress__mark--met" : "gg-tc-progress__mark"}
            style={{ left: `${p.minimumPercent}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {need && need.valueCents > 0 && (
        <p className="gg-tc-progress__need">
          Trade in <strong>{formatCents(need.valueCents)}</strong> of your cards at TCG low to cover ours ({need.ratePercent}% trade
          credit)
        </p>
      )}
      {!compact && (
        <>
          <div className="gg-tc-progress__scale" aria-hidden="true">
            {showMark &&
              (labelAtMark ? (
                <span className="gg-tc-progress__scale-min" style={{ left: `${p.minimumPercent}%` }}>
                  {moneyShort(p.minimumCents)} minimum
                </span>
              ) : (
                <span className="gg-tc-progress__scale-start">{moneyShort(p.minimumCents)} minimum</span>
              ))}
            <span className="gg-tc-progress__scale-end">{moneyShort(p.thresholdCents)} free shipping</span>
          </div>
          <p className="gg-tc-progress__fee">
            <span>
              Shipping our cards to you
              <span className="gg-tc-progress__fee-note">
                {p.shippingCents === 0 && wantedCents > 0 ? "Tracked, on us" : `Tracked, ${freeFrom} · paid by card when your trade is final`}
              </span>
            </span>
            <strong>{fee}</strong>
          </p>
          <p className="gg-tc-progress__theirs">You ship your cards to us separately, with tracking, at your cost.</p>
        </>
      )}
    </div>
  );
}
