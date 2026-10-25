import { useState, type FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { getStripePromise } from "../../lib/stripeClient";

// Stripe's card form for a trade payment (the refundable deposit, or the
// rest of a trade). The card details go straight to Stripe; we only ever
// see the PaymentIntent's id. The amount is the server's (the PaymentIntent
// it created); this form just collects the card.

export function TradeCardPayment({
  clientSecret,
  amountCents,
  payLabel,
  returnUrl,
  onPaid,
}: {
  clientSecret: string;
  amountCents: number;
  /** The button: "Pay the $20.00 deposit". */
  payLabel: string;
  /** Where the bank check (if any) comes back to. */
  returnUrl: string;
  onPaid: (paymentIntentId: string) => Promise<void>;
}) {
  return (
    <Elements stripe={getStripePromise()} options={{ mode: "payment", amount: amountCents, currency: "usd", paymentMethodTypes: ["card"] }}>
      <TradeCardForm clientSecret={clientSecret} payLabel={payLabel} returnUrl={returnUrl} onPaid={onPaid} />
    </Elements>
  );
}

function TradeCardForm({
  clientSecret,
  payLabel,
  returnUrl,
  onPaid,
}: {
  clientSecret: string;
  payLabel: string;
  returnUrl: string;
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
      confirmParams: { return_url: returnUrl },
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
        {submitting ? "Processing…" : payLabel}
      </button>
    </form>
  );
}
