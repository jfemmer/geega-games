import { useState } from "react";
import { isStripeConfigured } from "../../lib/stripeClient";
import { formatCents } from "../../lib/money";
import { CONDITION_LABELS } from "../../lib/conditionLabels";
import { useNow } from "../../lib/useNow";
import {
  FINISH_NAMES,
  formatDeadline,
  timeLeft,
  tradeCreditCents,
  tradeLabel,
  tradeShippingTerms,
  type CustomerTrade,
} from "../../lib/tradeCenter";
import { moneyShort, tradeShippingCents } from "../../lib/tradeShipping";
import type { ConfirmResponse } from "../../lib/tradeCenterApi";
import { TradeCardPayment } from "./TradeCardForm";
import { returnUrlFor } from "./tradePayment";
import { TradeAskForTime } from "./TradeAskForTime";

// Confirming an approved trade. Everything the customer is agreeing to is on
// this one screen: the cards they're getting, what ours are worth and what
// theirs are estimated at, the deposit and exactly when it's refunded or
// could be kept, both deadlines, and how to ship. They tick the box, then
// confirm (and pay the deposit, when there is one). The deadlines here come
// from the server; the countdown is only a guide.

export function TradeConfirmPanel({
  trade,
  busy,
  askBusy,
  onConfirm,
  onDepositPaid,
  onAskForTime,
}: {
  trade: CustomerTrade;
  busy: boolean;
  askBusy: boolean;
  /** Confirms (agreeing to this version of the terms); with a deposit, returns the payment to finish. */
  onConfirm: (termsVersion: number) => Promise<ConfirmResponse | null>;
  /** Stripe took the deposit (or is still processing it): the trade page records it. */
  onDepositPaid: (paymentIntentId: string) => Promise<void>;
  onAskForTime: (note: string) => Promise<boolean>;
}) {
  const now = useNow();
  const [agreed, setAgreed] = useState(false);
  const [payment, setPayment] = useState<{ clientSecret: string; amountCents: number } | null>(null);
  const c = trade.confirmation;
  if (!c) return null;

  const deposit = c.depositCents;
  const confirmBy = Date.parse(c.confirmBy);
  const late = now > confirmBy;
  const value = trade.approvedValueCents ?? trade.estimatedValueCents;
  const credit = tradeCreditCents(value, trade.creditRatePercent, trade.processingFeeCents);
  const shipping = tradeShippingCents(trade.wantedTotalCents, tradeShippingTerms(trade));
  const onlineOk = c.canPayOnline && isStripeConfigured;
  const wanted = trade.wanted.filter((w) => w.status === "requested" || w.status === "reserved");
  const short = wanted.filter((w) => w.available !== null && w.available < w.quantity);
  const resuming = trade.status === "awaiting_deposit";
  const paragraphs = c.termsText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const cannotPay = deposit > 0 && !onlineOk;

  async function confirm() {
    const res = await onConfirm(c!.termsVersion);
    if (res?.clientSecret && res.depositCents) setPayment({ clientSecret: res.clientSecret, amountCents: res.depositCents });
  }

  async function paid(paymentIntentId: string) {
    await onDepositPaid(paymentIntentId);
    // Reserved: this panel goes away. Still processing: back to the button,
    // which says so if it's pressed before the payment settles.
    setPayment(null);
    setAgreed(false);
  }

  return (
    <section className="gg-tc-panel gg-tc-confirm" aria-labelledby="gg-tc-confirm-title">
      <h2 id="gg-tc-confirm-title">{resuming ? "Finish paying your deposit" : "Confirm your trade"}</h2>
      <p className="gg-tc-deadline">
        {late ? (
          <>The time to confirm ran out at {formatDeadline(c.confirmBy)}.</>
        ) : (
          <>
            Confirm by <strong>{formatDeadline(c.confirmBy)}</strong> ({timeLeft(confirmBy, now)} left). Until you do, our cards stay on
            sale.
          </>
        )}
      </p>

      <dl className="gg-tc-facts">
        <div>
          <dt>Cards you&rsquo;re receiving</dt>
          <dd>
            {wanted.reduce((n, w) => n + w.quantity, 0)} card{wanted.reduce((n, w) => n + w.quantity, 0) === 1 ? "" : "s"} (listed below)
          </dd>
        </div>
        <div>
          <dt>Total reserved market value</dt>
          <dd>{formatCents(trade.wantedTotalCents)}</dd>
        </div>
        <div>
          <dt>Your trade-in cards (approved estimate)</dt>
          <dd>
            {formatCents(value)}
            <span className="gg-tc-facts__sub">{formatCents(credit)} in trade credit</span>
          </dd>
        </div>
        <div>
          <dt>Shipping our cards to you</dt>
          <dd>
            {shipping > 0 ? formatCents(shipping) : "FREE"}
            <span className="gg-tc-facts__sub">
              {shipping > 0
                ? `Tracked; ${trade.freeShipFeeCents > 0 ? `${moneyShort(trade.freeShipFeeCents)}` : "free"} from ${moneyShort(trade.freeShipThresholdCents)}. Paid by card once you accept the final offer, never now.`
                : "Tracked, on us."}
            </span>
          </dd>
        </div>
        <div>
          <dt>Refundable deposit</dt>
          <dd>
            {deposit > 0 ? formatCents(deposit) : "None needed"}
            {deposit > 0 && <span className="gg-tc-facts__sub">Separate from shipping and your trade&rsquo;s payment</span>}
          </dd>
        </div>
        <div>
          <dt>Confirmation deadline</dt>
          <dd>{formatDeadline(c.confirmBy)}</dd>
        </div>
        <div>
          <dt>Shipping deadline after you confirm</dt>
          <dd>
            {formatDeadline(c.shipByIfConfirmedNow)}
            <span className="gg-tc-facts__sub">
              if you confirm now: {c.shipDays} day{c.shipDays === 1 ? "" : "s"}, Sundays don&rsquo;t count
            </span>
          </dd>
        </div>
      </dl>

      <ul className="gg-tc-confirm__cards">
        {wanted.map((w) => {
          const soldOut = w.available !== null && w.available < w.quantity;
          return (
            <li key={w.id} className={soldOut ? "gg-tc-confirm__card gg-tc-confirm__card--short" : "gg-tc-confirm__card"}>
              <span>
                {w.quantity} × <strong>{w.cardName}</strong>{" "}
                <span className="gg-tc-line__meta">
                  {[w.setCode?.toUpperCase(), CONDITION_LABELS[w.condition] ?? w.condition, w.finish !== "nonfoil" ? FINISH_NAMES[w.finish] ?? w.finish : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {soldOut && (
                  <span className="gg-tc-confirm__warn">
                    {w.available === 0 ? "Sold since we approved your trade" : `Only ${w.available} left`}
                  </span>
                )}
              </span>
              <span className="gg-tc-confirm__price">{formatCents(w.unitPriceCents * w.quantity)}</span>
            </li>
          );
        })}
      </ul>
      {trade.approvalConditions && (
        <p className="gg-tc-note">
          <strong>Approved on this condition:</strong> {trade.approvalConditions}
        </p>
      )}
      {short.length > 0 && (
        <p className="gg-alert gg-alert-warn">
          Some of our cards sold since we approved your trade. If you confirm, nothing is reserved or charged: your trade comes back to
          you to update, and we&rsquo;ll review it again right away.
        </p>
      )}

      <div className="gg-tc-terms">
        {deposit > 0 ? (
          <>
            <h3>Refundable Reservation Deposit</h3>
            {paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </>
        ) : (
          <>
            <h3>What confirming means</h3>
            <p>
              Confirming reserves our cards for you and takes them off sale. There&rsquo;s no deposit on this trade. Please only confirm if
              you&rsquo;ll ship: canceling after confirming, or not shipping in time, counts against future trades.
            </p>
          </>
        )}
        <dl className="gg-tc-terms__list">
          {deposit > 0 && (
            <div>
              <dt>Refund</dt>
              <dd>
                The full {formatCents(deposit)}, as soon as the carrier accepts your package by your shipping deadline. Declining our offer
                after your cards arrive never costs your deposit.
              </dd>
            </div>
          )}
          <div>
            <dt>Potential cancellation charge</dt>
            <dd>
              {deposit > 0
                ? `Up to ${formatCents(deposit)} (your deposit), only if you cancel after confirming and before shipping, or don't ship by the deadline. A person reviews every case before any deposit is kept.`
                : "None."}
            </dd>
          </div>
          <div>
            <dt>Shipping requirements</dt>
            <dd>
              Ship within {c.shipDays} day{c.shipDays === 1 ? "" : "s"} of confirming (Sundays don&rsquo;t count; Saturdays do), with tracking.
              It counts when the carrier scans your package; a label on its own doesn&rsquo;t. Put your trade ID, {tradeLabel(trade.tradeNumber)},
              inside.
            </dd>
          </div>
        </dl>
      </div>

      {payment ? (
        <div className="gg-tc-confirm__pay">
          <h3>Pay your {formatCents(payment.amountCents)} deposit</h3>
          <p className="gg-tc-line__meta">Our cards are reserved the moment it goes through.</p>
          <TradeCardPayment
            clientSecret={payment.clientSecret}
            amountCents={payment.amountCents}
            payLabel={`Pay the ${formatCents(payment.amountCents)} deposit`}
            returnUrl={returnUrlFor("deposit")}
            onPaid={paid}
          />
        </div>
      ) : (
        <form
          className="gg-tc-confirm__go"
          onSubmit={(e) => {
            e.preventDefault();
            if (agreed && !late && !cannotPay) void confirm();
          }}
        >
          <label className="gg-tc-ack">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
            <span>
              {deposit > 0
                ? "I've read the deposit and cancellation terms above and agree to them, and I'll ship my cards by the shipping deadline."
                : "I'll ship my cards by the shipping deadline, and I understand our cards are reserved for me only until then."}
            </span>
          </label>
          {cannotPay && (
            <p className="gg-alert gg-alert-warn">
              Paying the deposit online isn&rsquo;t available right now. Send us a message below and we&rsquo;ll help you confirm.
            </p>
          )}
          <button type="submit" className="gg-btn gg-tc-confirm__btn" disabled={busy || !agreed || late || cannotPay}>
            {busy ? "Confirming…" : deposit > 0 ? (resuming ? "Pay the deposit" : "Confirm Trade & Pay Deposit") : "Confirm Trade"}
          </button>
          {deposit > 0 && !resuming && (
            <p className="gg-tc-line__meta">Next you&rsquo;ll pay the {formatCents(deposit)} deposit by card. Nothing is reserved until it goes through.</p>
          )}
        </form>
      )}
      {!late && !payment && <TradeAskForTime what="confirm" busy={askBusy} onAsk={onAskForTime} />}
    </section>
  );
}
