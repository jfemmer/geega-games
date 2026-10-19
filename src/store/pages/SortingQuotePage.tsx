import { useEffect, useRef, useState, type FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Link, useRouter } from "../lib/router";
import { useAuth } from "../lib/AuthContext";
import { useSEO } from "../lib/useSEO";
import { formatCents } from "../lib/money";
import { authLinkWithReturn } from "../lib/authRedirect";
import { getStripePromise, isStripeConfigured } from "../lib/stripeClient";
import { SUPPORT_EMAIL } from "./StaticPages";
import SortingQuoteTable from "../components/sorting/SortingQuoteTable";
import { ShippingInfoNotice } from "../components/sorting/SortingPolicy";
import {
  approveSortingQuote,
  confirmSortingPayment,
  declineSortingQuote,
  lookupSortingRequest,
  startSortingPayment,
  type SortingQuoteAccess,
  type SortingRequestView,
} from "../lib/sortingApi";
import {
  SORTING_DELIVERY_LABELS,
  SORTING_LIMITS,
  SORTING_PATH,
  SORTING_QUOTE_PATH,
  formatRatePerThousand,
} from "../lib/sortingService";

// The customer's collection sorting quote (/collection-sorting/quote). The
// link in the quote email carries ?ref=&email=&t= and opens the request
// straight away; anyone can also type their reference number and email.
//
// Here the customer reads their itemized quote — sorting, return shipping,
// return packaging, any other agreed charge and the total — approves or
// declines it, and pays the balance by card. Approving needs the email
// link's token or the signed-in account the request belongs to (the server
// checks; see api/sorting-quote.ts). An approved total is shown as approved:
// a revised quote only replaces it if the customer approves that one too.

function dateLabel(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
}

export default function SortingQuotePage() {
  useSEO({
    title: "Your Sorting Quote | Geega Games",
    description: "Review, approve and pay for your Magic: The Gathering collection sorting quote.",
    path: SORTING_QUOTE_PATH,
  });

  const { query } = useRouter();
  const { user } = useAuth();
  const [refInput, setRefInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [access, setAccess] = useState<SortingQuoteAccess | null>(null);
  const [request, setRequest] = useState<SortingRequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const autoLoaded = useRef(false);

  const load = async (next: SortingQuoteAccess) => {
    setBusy(true);
    setError(null);
    try {
      const view = await lookupSortingRequest(next);
      setAccess(next);
      setRequest(view);
      return view;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  // The email link: look it up straight away. A card payment that had to
  // leave the page (bank authentication) comes back with payment_intent=…
  useEffect(() => {
    if (autoLoaded.current) return;
    const ref = query.get("ref");
    const email = query.get("email");
    if (!ref || !email) return;
    autoLoaded.current = true;
    setRefInput(ref);
    setEmailInput(email);
    const next: SortingQuoteAccess = { referenceNumber: ref, email, token: query.get("t") };
    const returnedIntent = query.get("payment_intent");
    void (async () => {
      const view = await load(next);
      if (view && returnedIntent) {
        const params = new URLSearchParams(window.location.search);
        params.delete("payment_intent");
        params.delete("payment_intent_client_secret");
        params.delete("redirect_status");
        window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
        try {
          const confirmed = await confirmSortingPayment(next, returnedIntent);
          setRequest(confirmed.request);
          setNotice(
            confirmed.paymentStatus === "succeeded"
              ? "Thanks — your payment went through."
              : "Your payment is processing. We'll email you as soon as it clears.",
          );
        } catch (err) {
          setError(err instanceof Error ? err.message : "We couldn't confirm your payment. Please contact us.");
        }
      }
    })();
    // Once, from the query the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitLookup = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    void load({ referenceNumber: refInput.trim(), email: emailInput.trim(), token: null });
  };

  const reset = () => {
    setRequest(null);
    setAccess(null);
    setError(null);
    setNotice(null);
    setRefInput("");
    setEmailInput("");
  };

  if (request && access) {
    return (
      <QuoteView
        request={request}
        access={access}
        signedIn={!!user}
        notice={notice}
        onChange={(view, message) => {
          setRequest(view);
          setNotice(message ?? null);
        }}
        onReset={reset}
      />
    );
  }

  return (
    <div className="gg-page gg-sort-quote-page">
      <h1>Your sorting quote</h1>
      <p className="gg-card-meta">
        Enter the reference number from your sorting request email (it starts with GG-SR-) and the email
        you used.
      </p>
      <form className="gg-form gg-sort-lookup" onSubmit={submitLookup}>
        <div className="gg-field">
          <label htmlFor="sq-ref">Reference number</label>
          <input
            id="sq-ref"
            autoComplete="off"
            placeholder="GG-SR-1001"
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            required
          />
        </div>
        <div className="gg-field">
          <label htmlFor="sq-email">Email</label>
          <input
            id="sq-email"
            type="email"
            autoComplete="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            required
          />
        </div>
        {error && (
          <div className="gg-alert gg-alert-error" role="alert">
            {error}
          </div>
        )}
        <button className="gg-btn" type="submit" disabled={busy}>
          {busy ? "Looking it up…" : "Find my quote"}
        </button>
      </form>
      <p className="gg-card-meta" style={{ marginTop: "1rem" }}>
        New here? <Link to={SORTING_PATH}>Learn about collection sorting</Link>.
      </p>
    </div>
  );
}

function QuoteView({
  request,
  access,
  signedIn,
  notice,
  onChange,
  onReset,
}: {
  request: SortingRequestView;
  access: SortingQuoteAccess;
  signedIn: boolean;
  notice: string | null;
  onChange: (view: SortingRequestView, message?: string) => void;
  onReset: () => void;
}) {
  const [acting, setActing] = useState<null | "approve" | "decline">(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shipped = request.deliveryMethod === "ship";
  const open = request.openQuote;
  const approved = request.acceptedQuote;

  const respond = async (kind: "approve" | "decline") => {
    if (!open) return;
    setActing(kind);
    setError(null);
    try {
      if (kind === "approve") {
        onChange(await approveSortingQuote(access, open.id), "Thanks — your quote is approved.");
      } else {
        onChange(
          await declineSortingQuote(access, open.id, reason.trim()),
          "You declined this quote. We'll be in touch about what's next.",
        );
        setDeclining(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setActing(null);
    }
  };

  const signInLink = authLinkWithReturn("/login");

  return (
    <div className="gg-page gg-sort-quote-page">
      <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={onReset}>
        ← Look up a different request
      </button>
      <h1>Sorting request {request.referenceNumber}</h1>
      <p className="gg-card-meta">Hi {request.firstName},</p>
      <p className="gg-sort-status">
        <span className="gg-badge">{request.statusLabel}</span>
      </p>

      {notice && (
        <div className="gg-alert gg-alert-ok" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="gg-alert gg-alert-error" role="alert">
          {error}
        </div>
      )}

      <dl className="gg-sort-facts">
        <div>
          <dt>Service</dt>
          <dd>
            {request.optionName} · {formatRatePerThousand(request.ratePerThousandCents)}
          </dd>
        </div>
        <div>
          <dt>Your estimate</dt>
          <dd>
            About {request.estimatedCards.toLocaleString("en-US")} cards · {formatCents(request.estimatedSortingCents)}
            {shipped ? " + return shipping & packaging" : ""}
          </dd>
        </div>
        <div>
          <dt>Getting it to us</dt>
          <dd>{SORTING_DELIVERY_LABELS[request.deliveryMethod]}</dd>
        </div>
        {request.returnTo && (
          <div>
            <dt>Shipping back to</dt>
            <dd>{request.returnTo}</dd>
          </div>
        )}
      </dl>

      {open ? (
        <section className="gg-sort-quote-card" aria-labelledby="sq-open">
          <h2 id="sq-open">{approved ? "Your revised quote" : "Your quote"}</h2>
          {approved && (
            <div className="gg-alert gg-alert-warn">
              You approved {formatCents(approved.totalCents)} on {dateLabel(approved.acceptedAt)}. This revised
              quote replaces it only if you approve it — until then, your approved total stays the same.
            </div>
          )}
          <SortingQuoteTable quote={open} delivery={request.deliveryMethod} />
          {request.canRespond ? (
            declining ? (
              <div className="gg-sort-decline">
                <label htmlFor="sq-reason">Want to tell us why? (optional)</label>
                <textarea
                  id="sq-reason"
                  rows={3}
                  maxLength={SORTING_LIMITS.maxDeclineReason}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="gg-sort-actions">
                  <button
                    type="button"
                    className="gg-btn gg-btn-ghost"
                    disabled={acting !== null}
                    onClick={() => void respond("decline")}
                  >
                    {acting === "decline" ? "Sending…" : "Decline quote"}
                  </button>
                  <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => setDeclining(false)}>
                    Never mind
                  </button>
                </div>
              </div>
            ) : (
              <div className="gg-sort-actions">
                <button
                  type="button"
                  className="gg-btn"
                  disabled={acting !== null}
                  onClick={() => void respond("approve")}
                >
                  {acting === "approve" ? "Approving…" : `Approve ${formatCents(open.totalCents)}`}
                </button>
                <button type="button" className="gg-btn gg-btn-ghost" onClick={() => setDeclining(true)}>
                  Decline
                </button>
              </div>
            )
          ) : (
            <p className="gg-alert gg-alert-warn">
              To approve this quote, open the link in your quote email
              {signedIn ? "." : <> — or <Link to={signInLink}>sign in</Link> to the account you used for this request.</>}
            </p>
          )}
          <p className="gg-card-meta">Questions about your quote? Reply to your quote email or write to {SUPPORT_EMAIL}.</p>
        </section>
      ) : approved ? (
        <section className="gg-sort-quote-card" aria-labelledby="sq-approved">
          <h2 id="sq-approved">Your approved quote</h2>
          <p className="gg-card-meta">Approved {dateLabel(approved.acceptedAt)}</p>
          <SortingQuoteTable quote={approved} delivery={request.deliveryMethod} totalLabel="Approved total" />
          <PaymentPanel request={request} access={access} signedIn={signedIn} onChange={onChange} />
        </section>
      ) : request.latestQuote?.status === "declined" ? (
        <div className="gg-alert gg-alert-warn">
          You declined our quote on {dateLabel(request.latestQuote.declinedAt)}. We&rsquo;ll be in touch about
          what&rsquo;s next — or email {SUPPORT_EMAIL} with any questions.
        </div>
      ) : request.status === "cancelled" ? (
        <div className="gg-alert gg-alert-warn">This request was cancelled. Questions? Email {SUPPORT_EMAIL}.</div>
      ) : (
        <section className="gg-sort-quote-card">
          <h2>No quote yet</h2>
          <p>
            We&rsquo;ll email your complete quote once your cards are counted
            {shipped ? " — sorting, plus return shipping and packaging" : ""}. You won&rsquo;t pay anything until
            you approve it.
          </p>
        </section>
      )}

      {request.returnTracking && (
        <p className="gg-sort-tracking">
          Shipped back{request.returnTracking.carrier ? ` with ${request.returnTracking.carrier}` : ""} · tracking
          number <strong>{request.returnTracking.number}</strong>
        </p>
      )}

      {shipped && (
        <div className="gg-sort-quote-policy">
          <ShippingInfoNotice headingLevel={3} />
        </div>
      )}
    </div>
  );
}

function PaymentPanel({
  request,
  access,
  signedIn,
  onChange,
}: {
  request: SortingRequestView;
  access: SortingQuoteAccess;
  signedIn: boolean;
  onChange: (view: SortingRequestView, message?: string) => void;
}) {
  const [payment, setPayment] = useState<{ clientSecret: string; amountDueCents: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const due = request.balanceDueCents;
  const canPayOnline = request.payOnline && isStripeConfigured;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const result = await startSortingPayment(access);
      if (result.kind === "paid") onChange(result.request, "Your quote is already paid in full — thank you!");
      else setPayment({ clientSecret: result.clientSecret, amountDueCents: result.amountDueCents });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't start the payment. Please try again.");
    } finally {
      setStarting(false);
    }
  };

  const onPaid = async (paymentIntentId: string) => {
    try {
      const confirmed = await confirmSortingPayment(access, paymentIntentId);
      setPayment(null);
      onChange(
        confirmed.request,
        confirmed.paymentStatus === "succeeded"
          ? "Thanks — your payment went through. We've emailed you a receipt."
          : "Your payment is processing. We'll email you as soon as it clears.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't confirm your payment. Please contact us.");
    }
  };

  return (
    <div className="gg-sort-pay">
      <dl className="gg-sort-lines">
        <div className="gg-sort-line">
          <dt>Paid so far</dt>
          <dd>{formatCents(request.amountPaidCents)}</dd>
        </div>
        <div className="gg-sort-line gg-sort-line--total">
          <dt>Balance due</dt>
          <dd>{due > 0 ? formatCents(due) : "Paid in full"}</dd>
        </div>
      </dl>
      {error && (
        <div className="gg-alert gg-alert-error" role="alert">
          {error}
        </div>
      )}
      {due <= 0 ? (
        <p className="gg-alert gg-alert-ok">Paid in full — thank you!</p>
      ) : !request.canRespond ? (
        <p className="gg-alert gg-alert-warn">
          To pay online, open the link in your quote email
          {signedIn ? "." : <> — or <Link to={authLinkWithReturn("/login")}>sign in</Link> to the account you used.</>}
        </p>
      ) : !canPayOnline ? (
        <p className="gg-card-meta">
          Online payment isn&rsquo;t available right now — reply to your quote email and we&rsquo;ll sort out
          payment with you.
        </p>
      ) : payment ? (
        // Cards only, like checkout: the PaymentIntent (cards only too) is
        // attached at confirm time.
        <Elements
          stripe={getStripePromise()}
          options={{ mode: "payment", amount: payment.amountDueCents, currency: "usd", paymentMethodTypes: ["card"] }}
        >
          <SortingCardForm clientSecret={payment.clientSecret} amountCents={payment.amountDueCents} onPaid={onPaid} />
        </Elements>
      ) : (
        <button type="button" className="gg-btn" disabled={starting} onClick={() => void start()}>
          {starting ? "Starting…" : `Pay ${formatCents(due)} by card`}
        </button>
      )}
      {due > 0 && request.deliveryMethod === "drop_off" && (
        <p className="gg-card-meta">Rather pay in person? You can pay when you pick up your collection.</p>
      )}
    </div>
  );
}

function SortingCardForm({
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

  const submit = async (e: FormEvent) => {
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
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      redirect: "if_required",
      confirmParams: {
        // Only if a step has to leave the page (bank authentication); this
        // page picks the payment up again from ?payment_intent= when it's back.
        return_url: window.location.href,
      },
    });
    if (confirmError) {
      setCardError(confirmError.message ?? "Payment failed. Please check your card details and try again.");
      setSubmitting(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      await onPaid(paymentIntent.id);
      setSubmitting(false);
      return;
    }
    setCardError("Payment could not be completed. Please try a different card.");
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit} className="gg-form gg-pay-card">
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
