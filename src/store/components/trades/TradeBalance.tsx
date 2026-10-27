import type { ReactNode } from "react";
import { formatCents } from "../../lib/money";
import { DEPOSIT_STATUS_LABELS, tradeComparison, type CustomerTrade, type TradeComparison } from "../../lib/tradeCenter";
import { moneyShort, shippingLabel, type ShippingTerms } from "../../lib/tradeShipping";

// The running total on every trade screen, in the order a customer reads a
// trade: our cards, what of theirs it takes to cover them at the trade rate,
// what theirs are worth (estimated, approved or final) and the credit that
// earns, what of our cards the credit doesn't cover, shipping our cards to
// them, and the bottom line: what's paid by card at the end, and any credit
// left over. Trade credit covers our cards only: shipping is always paid by
// card, and the refundable deposit is separate from all of it. The bar shows
// how much of our cards the credit covers.

export function TradeBalance({
  wantedCents,
  offeredValueCents,
  valueLabel,
  ratePercent,
  feeCents = 0,
  shipping,
  shippingCents,
  title = "Your trade",
  excessLabel = "Kept as store credit for your next order",
  canAddCards = false,
  deposit,
  footnote,
  children,
}: {
  wantedCents: number;
  offeredValueCents: number;
  /** What the customer's cards are worth here: "estimated", "approved" or "final". */
  valueLabel: string;
  ratePercent: number;
  feeCents?: number;
  /** The trade's shipping terms (each trade keeps the ones it started on). */
  shipping: ShippingTerms;
  /** Once it's settled (the trade's own shipping); otherwise worked out from `shipping`. */
  shippingCents?: number;
  title?: string;
  excessLabel?: string;
  /** The customer can still add cards (a draft): then say how much more of theirs would cover ours. */
  canAddCards?: boolean;
  /** The deposit, shown apart from the money (see DepositLine). */
  deposit?: ReactNode;
  footnote?: ReactNode;
  children?: ReactNode;
}) {
  const c = tradeComparison({ wantedCents, offeredValueCents, ratePercent, feeCents, shippingCents, shipping });
  const percent = wantedCents > 0 ? Math.round(Math.min(c.creditCents / wantedCents, 1) * 100) : 0;
  return (
    <section className="gg-tc-balance" aria-label={title}>
      <h2 className="gg-tc-balance__title">{title}</h2>
      {wantedCents > 0 && (
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
            {c.creditCents >= wantedCents
              ? "Your credit covers all of our cards"
              : percent === 0
                ? "Add your cards to see how much of ours they cover"
                : `Your credit covers ${percent}% of our cards`}
          </p>
        </div>
      )}
      <TradeMoneyRows comparison={c} valueLabel={valueLabel} ratePercent={ratePercent} feeCents={feeCents} shipping={shipping} />
      <TradeMoneyTotals comparison={c} excessLabel={excessLabel} />
      {canAddCards && c.cardBalanceCents > 0 && c.moreValueNeededCents > 0 && c.offeredValueCents > 0 && (
        <p className="gg-tc-balance__hint gg-tc-balance__more">
          About {formatCents(c.moreValueNeededCents)} more in your cards would cover ours, or pay the rest by card at the end.
        </p>
      )}
      {deposit}
      {footnote && <p className="gg-tc-balance__foot">{footnote}</p>}
      {children}
    </section>
  );
}

/** The rows of a trade's money, from our cards down to shipping. */
export function TradeMoneyRows({
  comparison: c,
  valueLabel,
  ratePercent,
  feeCents = 0,
  shipping,
  creditNote,
}: {
  comparison: TradeComparison;
  valueLabel: string;
  ratePercent: number;
  feeCents?: number;
  shipping: ShippingTerms;
  /** Under the credit: what it was before (the final offer). */
  creditNote?: string;
}) {
  return (
    <dl className="gg-tc-balance__rows">
      <div>
        <dt>Our cards</dt>
        <dd>{formatCents(c.wantedCents)}</dd>
      </div>
      <div className="gg-tc-balance__need">
        <dt>
          Your cards needed
          <span className="gg-tc-balance__hint">At TCG low, to cover ours at {ratePercent}% trade credit</span>
        </dt>
        <dd>{formatCents(c.requiredValueCents)}</dd>
      </div>
      <div>
        <dt>Your cards ({valueLabel})</dt>
        <dd>{formatCents(c.offeredValueCents)}</dd>
      </div>
      <div className="gg-tc-balance__credit">
        <dt>
          Trade credit at {ratePercent}%{creditNote && <span className="gg-tc-balance__hint">{creditNote}</span>}
        </dt>
        <dd>{formatCents(c.creditCents)}</dd>
      </div>
      {feeCents > 0 && (
        <div>
          <dt>Processing fee (taken from the credit)</dt>
          <dd>{formatCents(feeCents)}</dd>
        </div>
      )}
      <div className="gg-tc-balance__split">
        <dt>Left to pay for our cards</dt>
        <dd>{formatCents(c.cardBalanceCents)}</dd>
      </div>
      <div>
        <dt>
          Shipping our cards to you
          <span className="gg-tc-balance__hint">{shippingHint(c, shipping)}</span>
        </dt>
        <dd>{shippingLabel(c.shippingCents, c.wantedCents)}</dd>
      </div>
    </dl>
  );
}

function shippingHint(c: TradeComparison, shipping: ShippingTerms): string {
  if (c.wantedCents > 0 && c.shippingCents === 0) return "Tracked, on us";
  const from =
    shipping.freeShipFeeCents > 0
      ? `${moneyShort(shipping.freeShipFeeCents)} from ${moneyShort(shipping.freeShipThresholdCents)}`
      : `Free from ${moneyShort(shipping.freeShipThresholdCents)}`;
  return `${from} · paid by card, not credit`;
}

/** The bottom line: paid by card at the end (our cards the credit doesn't cover, and shipping), and credit left over. */
export function TradeMoneyTotals({
  comparison: c,
  excessLabel,
  payLabel = "You'd pay by card",
}: {
  comparison: TradeComparison;
  excessLabel?: string;
  payLabel?: string;
}) {
  return (
    <>
      {(c.cashDueCents > 0 || c.excessCents === 0) && (
        <div className="gg-tc-balance__total">
          <span>{c.cashDueCents > 0 ? payLabel : "Nothing to pay by card"}</span>
          <strong>{formatCents(c.cashDueCents)}</strong>
        </div>
      )}
      {c.excessCents > 0 && (
        <div className="gg-tc-balance__total gg-tc-balance__total--credit">
          <span>Credit left over</span>
          <strong>{formatCents(c.excessCents)}</strong>
        </div>
      )}
      {c.excessCents > 0 && excessLabel && <p className="gg-tc-balance__hint gg-tc-balance__more">{excessLabel}</p>}
    </>
  );
}

/** The refundable deposit beside a trade's money: never part of it, never spent on it. */
export function DepositLine({ trade }: { trade: CustomerTrade }) {
  const d = trade.deposit;
  if (d.status === "not_required" || (d.cents === 0 && d.paidCents === null)) return null;
  return (
    <div className="gg-tc-balance__deposit">
      <span>
        Refundable deposit
        <span className="gg-tc-balance__hint">Separate from your trade&rsquo;s value and payment</span>
      </span>
      <span className="gg-tc-balance__deposit-amount">
        <strong>{formatCents(d.paidCents ?? d.cents)}</strong>
        <span className="gg-tc-balance__hint">{DEPOSIT_STATUS_LABELS[d.status]}</span>
      </span>
    </div>
  );
}
