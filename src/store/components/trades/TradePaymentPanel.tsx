import { useState } from "react";
import { isStripeConfigured } from "../../lib/stripeClient";
import { formatCents } from "../../lib/money";
import { formatDeadline, type CustomerTrade } from "../../lib/tradeCenter";
import { TradeCardPayment } from "./TradeCardForm";
import { payLabelFor, returnUrlFor } from "./tradePayment";

// What's left of a trade, paid by card once the customer has accepted the
// final offer: any of our cards their credit doesn't cover, and shipping our
// cards to them (never paid out of trade credit). The amounts come from the
// server (the trade's amount due and shipping); the payment is recorded by
// the trade page and the Stripe webhook, whichever is first, and finishes the
// trade once. The deposit is separate and never part of this payment.

export function TradePaymentPanel({
  trade,
  onStart,
  onPaid,
  onDecline,
}: {
  trade: CustomerTrade;
  onStart: () => Promise<{ clientSecret: string; amountDueCents: number } | null>;
  onPaid: (paymentIntentId: string) => Promise<void>;
  onDecline: () => void;
}) {
  const [payment, setPayment] = useState<{ clientSecret: string; amountDueCents: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const due = trade.amountDueCents ?? 0;
  const shipping = Math.min(trade.shippingCents ?? 0, due);
  const forCards = due - shipping;
  const credit = trade.finalCreditCents ?? 0;
  const creditOnCards = Math.min(credit, trade.wantedTotalCents);

  async function start() {
    setStarting(true);
    try {
      setPayment(await onStart());
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-pay-title">
      <h2 id="gg-tc-pay-title">Pay {formatCents(due)} to finish</h2>
      <p>
        Your trade credit covers {formatCents(creditOnCards)} of our cards. What&rsquo;s left is due
        {trade.paymentDueAt ? ` by ${formatDeadline(trade.paymentDueAt)}` : ""}, and as soon as it&rsquo;s paid we pack your new cards and
        ship them with tracking.
      </p>
      <dl className="gg-tc-balance__rows gg-tc-paybreakdown">
        <div>
          <dt>Left to pay for our cards</dt>
          <dd>{formatCents(forCards)}</dd>
        </div>
        <div>
          <dt>Shipping our cards to you</dt>
          <dd>{shipping > 0 ? formatCents(shipping) : "FREE"}</dd>
        </div>
        <div className="gg-tc-paybreakdown__total">
          <dt>Total by card</dt>
          <dd>{formatCents(due)}</dd>
        </div>
      </dl>
      {!isStripeConfigured ? (
        <p className="gg-alert gg-alert-warn">Paying online isn&rsquo;t available right now. Reply to your trade email and we&rsquo;ll sort it out.</p>
      ) : payment ? (
        <TradeCardPayment
          clientSecret={payment.clientSecret}
          amountCents={payment.amountDueCents}
          payLabel={payLabelFor(payment.amountDueCents)}
          returnUrl={returnUrlFor("balance")}
          onPaid={onPaid}
        />
      ) : (
        <button type="button" className="gg-btn" disabled={starting} onClick={() => void start()}>
          {starting ? "Starting…" : `Pay ${formatCents(due)} by card`}
        </button>
      )}
      <p className="gg-tc-line__meta">
        Changed your mind?{" "}
        <button type="button" className="gg-linkbtn" onClick={onDecline}>
          Decline instead and get your cards back (no penalty)
        </button>
      </p>
    </section>
  );
}
