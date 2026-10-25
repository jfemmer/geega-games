import { useState, type FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getStripePromise, isStripeConfigured } from "../../lib/stripeClient";
import { formatCents } from "../../lib/money";
import { formatDeadline, type CustomerTrade } from "../../lib/tradeCenter";

// The rest of a trade, paid by card, once the customer has accepted the
// final offer and their credit doesn't cover everything. The amount comes
// from the server (the trade's amount due); the payment is recorded by the
// trade page and the Stripe webhook, whichever is first, and finishes the
// trade once.

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
        Your trade credit covers {formatCents(trade.finalCreditCents ?? 0)}. The remaining {formatCents(due)} is due
        {trade.paymentDueAt ? ` by ${formatDeadline(trade.paymentDueAt)}` : ""}. As soon as it&rsquo;s paid we&rsquo;ll pack your new
        cards.
      </p>
      {!isStripeConfigured ? (
        <p className="gg-alert gg-alert-warn">Paying online isn&rsquo;t available right now. Reply to your trade email and we&rsquo;ll sort it out.</p>
      ) : payment ? (
        <Elements
          stripe={getStripePromise()}
          options={{ mode: "payment", amount: payment.amountDueCents, currency: "usd", paymentMethodTypes: ["card"] }}
        >
          <TradeCardForm clientSecret={payment.clientSecret} amountCents={payment.amountDueCents} onPaid={onPaid} />
        </Elements>
      ) : (
        <button type="button" className="gg-btn" disabled={starting} onClick={() => void start()}>
          {starting ? "Starting…" : `Pay ${formatCents(due)} by card`}
        </button>
      )}
      <p className="gg-tc-line__meta">
        Changed your mind?{" "}
        <button type="button" className="gg-linkbtn" onClick={onDecline}>
          Decline instead and get your cards back
        </button>
      </p>
    </section>
  );
}

function TradeCardForm({
  clientSecret,
  amountCents,
  onPaid,
}: {
  clientSecret: string;
  amountCents: number;
  onPaid: (paymentIntentId: string) => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setCardError(null);
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setCardError(submitError.message ?? "Please check your card details.");
      setSubmitting(false);
      return;
    }
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      redirect: "if_required",
      // Only if a bank check has to leave the page; the trade page picks the
      // payment up again from ?payment_intent= when it's back.
      confirmParams: { return_url: window.location.href },
    });
    if (error) {
      setCardError(error.message ?? "The payment didn't go through. Check your card details and try again.");
      setSubmitting(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      await onPaid(paymentIntent.id);
      setSubmitting(false);
      return;
    }
    setCardError("The payment couldn't be completed. Try a different card.");
    setSubmitting(false);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="gg-form gg-pay-card">
      <PaymentElement />
      {cardError && (
        <div className="gg-alert gg-alert-error" role="alert">
          {cardError}
        </div>
      )}
      <button className="gg-btn" disabled={!stripe || !elements || submitting} type="submit">
        {submitting ? "Processing…" : `Pay ${formatCents(amountCents)}`}
      </button>
    </form>
  );
}
