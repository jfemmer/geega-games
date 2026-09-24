import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { supabase } from "../../supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { Link, useRouter } from "../lib/router";
import { getStripePromise, isStripeConfigured } from "../lib/stripeClient";
import { isPayPalConfigured, paypalClientId } from "../lib/paypalClient";
import {
  formatCents,
  previewOrderTotals,
  amountUntilFreeShipping,
  type ShippingMethod,
} from "../lib/money";

// Checkout. The SERVER is the only pricing authority:
//   - checkout_create_order (called via /api/checkout/create-payment-intent)
//     atomically revalidates SELLABLE stock (physical minus active
//     reservations) and computes the canonical amount due. The totals shown
//     below are display-only previews, never trusted for money.
//   - A zero-balance order (fully covered by store credit) is marked paid by
//     that trusted DB path — no Stripe involved.
//   - A balance-due order gets a Stripe PaymentIntent for EXACTLY the
//     server-computed amount. The order is only ever marked "paid" by the
//     Stripe webhook (api/webhooks/stripe.ts) reading back from Stripe — this
//     page NEVER fabricates a paid state from the client-side confirmPayment
//     result alone; it polls the order and shows whatever the DB says.
//   - The Stripe form is cards only (incl. Apple Pay / Google Pay); the
//     server sets payment_method_types, so Dashboard settings can't add
//     Klarna, bank payments, etc. If a payment step ever has to leave the
//     page (return_url below), on return, the client re-reads the PaymentIntent by its client secret
//     (in the URL Stripe appends) rather than trusting anything else in the
//     URL, and resumes exactly like the non-redirect path.
//   - PayPal and Venmo are NOT Stripe methods for a US business; they're a
//     separate PayPal integration shown on the same payment step (see
//     PayPalPaymentButtons below and api/checkout/paypal.ts). The server
//     captures the PayPal payment and marks the order paid itself — this
//     page again only reads the result back.
//
// If neither VITE_STRIPE_PUBLISHABLE_KEY nor VITE_PAYPAL_CLIENT_ID is set
// (e.g. a preview env without payments configured yet), checkout falls back
// to the legacy path: the order is created pending_payment and the customer
// is told, honestly, that online payment isn't live yet.

type Address = {
  id: string;
  recipient: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

// Mirrors HOLD_MINUTES in api/_lib/checkoutHolds.ts (display only).
const CHECKOUT_HOLD_MINUTES = 30;

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls the order's payment_status until it leaves "unpaid" or attempts run out. */
async function pollPaymentStatus(orderId: string, attempts = 6, intervalMs = 2000): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    const { data } = await supabase
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .maybeSingle();
    if (data && data.payment_status !== "unpaid") {
      return data.payment_status === "paid";
    }
  }
  return false;
}

export default function CheckoutPage() {
  const { user, loading: authLoading } = useAuth();
  const { lines, subtotalCents, loading: cartLoading, refresh } = useCart();
  const { navigate } = useRouter();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<string | "new">("new");
  const [form, setForm] = useState<Partial<Address>>({ country: "US" });
  const [method, setMethod] = useState<ShippingMethod>("tracked");
  const [creditBalance, setCreditBalance] = useState(0);
  const [useCredit, setUseCredit] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);
  const [paidComplete, setPaidComplete] = useState(false); // zero-balance (store credit) order
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [dueCents, setDueCents] = useState(0);
  // True while the payment step (Stripe card form and/or PayPal/Venmo buttons)
  // should be shown for placedOrderId.
  const [awaitingPayment, setAwaitingPayment] = useState(false);
  const [paymentPendingSetup, setPaymentPendingSetup] = useState(false); // legacy / payments unavailable
  const [paymentProcessing, setPaymentProcessing] = useState(false); // PayPal capture pending review
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [cardPaymentDone, setCardPaymentDone] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login?next=/checkout", { replace: true });
    }
  }, [authLoading, user, navigate]);

  // Handles a return trip to return_url: Stripe appends
  // payment_intent_client_secret when a payment step (rarely, for cards —
  // e.g. some bank authentication flows) had to leave the page.
  // We never trust anything else in the URL — the PaymentIntent's own status,
  // read back from Stripe, is the only thing that decides what happens next.
  const handledReturnRef = useRef(false);
  useEffect(() => {
    if (handledReturnRef.current || !user) return;
    const params = new URLSearchParams(window.location.search);
    const returnedSecret = params.get("payment_intent_client_secret");
    const intentId = params.get("payment_intent");
    if (!returnedSecret || !intentId) return;
    handledReturnRef.current = true;
    window.history.replaceState({}, "", window.location.pathname);

    (async () => {
      const token = await getAccessToken();
      const genericError =
        "We couldn't confirm your payment. Please contact us and reference your order.";
      if (!token) {
        setError(genericError);
        return;
      }
      const res = await fetch(
        `/api/checkout/payment-intent-status?id=${encodeURIComponent(intentId)}`,
        { headers: { Authorization: `Bearer ${token}` }, credentials: "same-origin" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(genericError);
        return;
      }
      const orderId: string | null = body.orderId ?? null;
      if (orderId) {
        setPlacedOrderId(orderId);
        await refresh();
      }
      if (body.status === "succeeded" || body.status === "processing") {
        if (orderId) await handlePaid(orderId);
        else setCardPaymentDone(true);
      } else if (body.status === "requires_payment_method") {
        setDueCents(body.amountDueCents ?? 0);
        setClientSecret(returnedSecret);
        setAwaitingPayment(true);
        setError("Your payment wasn't completed. Please try again.");
      } else if (orderId) {
        setPaymentPendingSetup(true);
      } else {
        // Neither a recognized status nor an order to fall back on — this
        // shouldn't happen, but silently doing nothing here would leave the
        // customer staring at an unchanged checkout page with no idea their
        // payment might have gone through. Give them something to act on.
        setError(
          `We couldn't confirm your payment status. Please contact us and reference this transaction: ${intentId}`,
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("addresses")
      .select("id, recipient, line1, line2, city, state, postal_code, country")
      // Secondary sort so ties among non-default (or, in principle, among
      // multiple default) addresses have a deterministic, meaningful order
      // instead of whatever arbitrary order Postgres happens to return —
      // which previously meant the auto-selected `rows[0]` for checkout
      // could silently be an unpredictable address.
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setError("Could not load your saved addresses. You can still enter one below.");
          return;
        }
        const rows = (data ?? []) as Address[];
        setAddresses(rows);
        if (rows.length) setSelectedAddr(rows[0].id);
      });
    supabase.rpc("my_store_credit_balance").then(({ data }) => {
      setCreditBalance(typeof data === "number" ? data : 0);
    });
  }, [user]);

  const totals = useMemo(
    () =>
      previewOrderTotals({
        subtotalCents,
        method,
        storeCreditBalanceCents: creditBalance,
        storeCreditRequestedCents: useCredit ? creditBalance : 0,
      }),
    [subtotalCents, method, creditBalance, useCredit],
  );

  const chosenAddress: Partial<Address> | null =
    selectedAddr === "new"
      ? form
      : addresses.find((a) => a.id === selectedAddr) ?? null;

  const addressValid =
    !!chosenAddress &&
    !!chosenAddress.line1 &&
    !!chosenAddress.city &&
    !!chosenAddress.state &&
    !!chosenAddress.postal_code;

  const placeOrder = async () => {
    setError(null);
    if (!addressValid) {
      setError("Please provide a complete shipping address.");
      return;
    }
    setPlacing(true);
    try {
      // Persist a new address if entered inline (so it's saved for reuse).
      if (selectedAddr === "new" && user) {
        await supabase.from("addresses").insert({
          user_id: user.id,
          recipient: form.recipient ?? null,
          line1: form.line1 ?? "",
          line2: form.line2 ?? null,
          city: form.city ?? "",
          state: form.state ?? "",
          postal_code: form.postal_code ?? "",
          country: form.country ?? "US",
        });
      }

      // Any online payment method → the server creates the order (and the
      // Stripe PaymentIntent, when Stripe is configured) and first releases
      // this customer's earlier unpaid checkout holds.
      if (isStripeConfigured || isPayPalConfigured) {
        await placeOrderViaServer();
      } else {
        await placeOrderLegacy();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setPlacing(false);
    }
  };

  // Online-payment path: server creates the canonical order AND (if a
  // balance is due and Stripe is configured) a PaymentIntent for exactly
  // that amount, in one call. The cart is NOT emptied here — the order only
  // holds its cards for a limited time, and the cart is cleared once the
  // order is actually paid (mark_order_paid).
  const placeOrderViaServer = async () => {
    const token = await getAccessToken();
    if (!token) throw new Error("Please sign in to check out.");
    const res = await fetch("/api/checkout/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      body: JSON.stringify({
        shippingMethod: method,
        storeCreditRequestedCents: useCredit ? creditBalance : 0,
        ship: {
          recipient: chosenAddress?.recipient ?? undefined,
          line1: chosenAddress?.line1 ?? undefined,
          line2: chosenAddress?.line2 ?? undefined,
          city: chosenAddress?.city ?? undefined,
          state: chosenAddress?.state ?? undefined,
          postalCode: chosenAddress?.postal_code ?? undefined,
          country: chosenAddress?.country ?? "US",
        },
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      // The order may still have been created (e.g. PaymentIntent creation
      // failed after order creation) — surface that honestly if so.
      if (body?.orderId) {
        setPlacedOrderId(body.orderId);
        await refresh();
        // Card payment couldn't start, but PayPal/Venmo may still work.
        if (isPayPalConfigured && body.amountDueCents > 0) {
          setDueCents(body.amountDueCents);
          setAwaitingPayment(true);
        } else {
          setPaymentPendingSetup(true);
        }
        return;
      }
      throw new Error(friendlyCheckoutError(body?.message || ""));
    }

    setPlacedOrderId(body.orderId);
    await refresh(); // a store-credit order was paid (and its cart cleared) on the spot

    if (body.paid) {
      setPaidComplete(true);
      return;
    }
    if (body.clientSecret || isPayPalConfigured) {
      setDueCents(body.amountDueCents ?? 0);
      setClientSecret(body.clientSecret ?? null);
      setAwaitingPayment(true);
      return;
    }
    // Shouldn't happen, but fail honestly rather than silently.
    setPaymentPendingSetup(true);
  };

  // Legacy path (no online payment configured at all): create the order
  // directly; any balance due stays pending_payment.
  const placeOrderLegacy = async () => {
    const { data, error: rpcError } = await supabase.rpc("checkout_create_order", {
      p_shipping_method: method,
      p_store_credit_requested_cents: useCredit ? creditBalance : 0,
      p_ship_recipient: chosenAddress?.recipient ?? null,
      p_ship_line1: chosenAddress?.line1 ?? null,
      p_ship_line2: chosenAddress?.line2 ?? null,
      p_ship_city: chosenAddress?.city ?? null,
      p_ship_state: chosenAddress?.state ?? null,
      p_ship_postal_code: chosenAddress?.postal_code ?? null,
      p_ship_country: chosenAddress?.country ?? "US",
    });
    if (rpcError) throw new Error(friendlyCheckoutError(rpcError.message));
    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error("Order could not be created.");

    setPlacedOrderId(result.order_id);
    await refresh();

    if (result.amount_due_cents === 0) {
      setPaidComplete(true);
    } else {
      setPaymentPendingSetup(true);
    }
  };

  const handlePaid = async (orderId: string) => {
    setConfirmingPayment(true);
    await pollPaymentStatus(orderId);
    // Whether or not the webhook had already landed by the time polling
    // stopped, the payment itself succeeded (Stripe confirmed it to us) —
    // the order page will always show the true DB state either way.
    setConfirmingPayment(false);
    setCardPaymentDone(true);
    // mark_order_paid removed the purchased cards from the cart.
    await refresh();
  };

  // Leave the payment step without paying. The order's hold stays until it
  // expires or the customer continues to payment again (which releases it
  // first), and the cart was never emptied, so the checkout form is intact.
  const backToCheckout = () => {
    setPlacedOrderId(null);
    setAwaitingPayment(false);
    setClientSecret(null);
    setDueCents(0);
    setError(null);
  };

  if (authLoading || cartLoading) {
    return <div className="gg-page">Loading…</div>;
  }

  // ---- Confirmation states -------------------------------------------------
  if (placedOrderId && (paidComplete || cardPaymentDone)) {
    return (
      <div className="gg-page gg-empty">
        <h1>Order confirmed 🎉</h1>
        <p>
          Your order is paid and confirmed. Order #
          {placedOrderId.slice(0, 8).toUpperCase()}.
        </p>
        <Link to={`/account/orders/${placedOrderId}`} className="gg-btn">
          View order
        </Link>
      </div>
    );
  }

  if (placedOrderId && paymentProcessing) {
    return (
      <div className="gg-page gg-empty">
        <h1>Payment processing</h1>
        <p>
          PayPal is still processing your payment for order #
          {placedOrderId.slice(0, 8).toUpperCase()}. Your cards are reserved, and
          we&rsquo;ll email you as soon as it clears.
        </p>
        <Link to={`/account/orders/${placedOrderId}`} className="gg-btn">
          View order
        </Link>
      </div>
    );
  }

  if (placedOrderId && awaitingPayment && !confirmingPayment) {
    return (
      <div className="gg-page">
        <h1 style={{ color: "var(--gg-ink)" }}>Payment</h1>
        <p className="gg-card-meta">
          Order #{placedOrderId.slice(0, 8).toUpperCase()} — we&rsquo;re holding your
          cards for {CHECKOUT_HOLD_MINUTES} minutes. Complete payment below to finish your
          order; if you don&rsquo;t, they go back on sale and stay in your cart.
        </p>
        <button type="button" className="gg-btn gg-btn-ghost" onClick={backToCheckout}>
          ← Back to checkout
        </button>
        {error && (
          <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
            {error}
          </div>
        )}
        {isPayPalConfigured && (
          <PayPalPaymentButtons
            orderId={placedOrderId}
            onPaid={() => handlePaid(placedOrderId)}
            onPending={() => setPaymentProcessing(true)}
            onError={setError}
          />
        )}
        {isPayPalConfigured && clientSecret && (
          <div className="gg-pay-divider" role="separator">
            <span>or pay with card</span>
          </div>
        )}
        {clientSecret && (
          <Elements stripe={getStripePromise()} options={{ clientSecret }}>
            <StripePaymentForm dueCents={dueCents} onPaid={() => handlePaid(placedOrderId)} />
          </Elements>
        )}
      </div>
    );
  }

  if (placedOrderId && confirmingPayment) {
    return (
      <div className="gg-page gg-empty">
        <h1>Confirming your payment…</h1>
        <p>This only takes a moment. Please don&rsquo;t close this page.</p>
      </div>
    );
  }

  if (placedOrderId && paymentPendingSetup) {
    return (
      <div className="gg-page gg-empty">
        <h1>Order created — payment pending</h1>
        <p>
          We created your order (#{placedOrderId.slice(0, 8).toUpperCase()}) and
          reserved your cards, but <strong>no money has been charged</strong>.
        </p>
        <p className="gg-alert gg-alert-warn" style={{ maxWidth: 560, margin: "1rem auto" }}>
          {isStripeConfigured || isPayPalConfigured
            ? "We couldn't start payment just now — please try again shortly, or contact us and reference this order."
            : "The store owner is finishing payment setup. Your order is saved as pending — you can view it in your account."}
        </p>
        <Link to={`/account/orders/${placedOrderId}`} className="gg-btn">
          View order
        </Link>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="gg-page gg-empty">
        <h1>Your cart is empty</h1>
        <Link to="/shop" className="gg-btn">
          Browse singles
        </Link>
      </div>
    );
  }

  const freeGap = amountUntilFreeShipping(subtotalCents);

  return (
    <div className="gg-page">
      <h1 style={{ color: "var(--gg-ink)" }}>Checkout</h1>
      {error && (
        <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      <div className="gg-shop">
        <div>
          {/* Cart review */}
          <h2>Review</h2>
          {lines.map((l) => (
            <div className="gg-line" key={l.inventoryItemId}>
              {l.imageUrl && (
                <img className="gg-line-img" src={l.imageUrl} alt="" loading="lazy" />
              )}
              <div className="gg-line-info">
                <div className="gg-card-name">
                  {l.name}
                  {l.variantType && (
                    <span className="gg-badge gg-badge-variant" style={{ marginLeft: "0.4rem" }}>
                      {l.variantType}
                    </span>
                  )}
                </div>
                <div className="gg-card-meta">
                  {l.setName ?? l.setCode?.toUpperCase()} · {l.condition} × {l.quantity}
                </div>
              </div>
              <div className="gg-price">
                {formatCents(l.priceCents * l.quantity)}
              </div>
            </div>
          ))}

          {/* Address */}
          <h2 style={{ marginTop: "1.5rem" }}>Shipping address</h2>
          {addresses.length > 0 && (
            <div className="gg-field">
              <label htmlFor="addr">Saved addresses</label>
              <select
                id="addr"
                value={selectedAddr}
                onChange={(e) => setSelectedAddr(e.target.value)}
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.recipient} — {a.line1}, {a.city} {a.state}
                  </option>
                ))}
                <option value="new">+ Use a new address</option>
              </select>
            </div>
          )}
          {selectedAddr === "new" && (
            <div className="gg-form" style={{ margin: "0.5rem 0 0", maxWidth: "none" }}>
              {(
                [
                  ["recipient", "Recipient"],
                  ["line1", "Address line 1"],
                  ["line2", "Address line 2 (optional)"],
                  ["city", "City"],
                  ["state", "State"],
                  ["postal_code", "Postal code"],
                  ["country", "Country"],
                ] as const
              ).map(([field, label]) => (
                <div className="gg-field" key={field}>
                  <label>{label}</label>
                  <input
                    value={(form[field] as string) ?? ""}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, [field]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          {/* Shipping method */}
          <h2 style={{ marginTop: "1.5rem" }}>Shipping method</h2>
          <label className="gg-check">
            <input
              type="radio"
              name="ship"
              checked={method === "tracked"}
              onChange={() => setMethod("tracked")}
            />
            Tracked{" "}
            {freeGap === 0
              ? "(free)"
              : `(${formatCents(550)}; free over ${formatCents(8500)})`}
          </label>
          <label className="gg-check">
            <input
              type="radio"
              name="ship"
              checked={method === "pwe"}
              onChange={() => setMethod("pwe")}
            />
            Plain White Envelope ({formatCents(150)}, untracked)
          </label>
        </div>

        {/* Summary */}
        <aside className="gg-filters" style={{ alignSelf: "start" }}>
          <h2 style={{ marginTop: 0 }}>Summary</h2>
          <SummaryRow label="Subtotal" value={totals.subtotalCents} />
          <SummaryRow label="Shipping" value={totals.shippingCents} />
          {creditBalance > 0 && (
            <label className="gg-check" style={{ margin: "0.5rem 0" }}>
              <input
                type="checkbox"
                checked={useCredit}
                onChange={(e) => setUseCredit(e.target.checked)}
              />
              Apply store credit ({formatCents(creditBalance)})
            </label>
          )}
          {totals.storeCreditUsedCents > 0 && (
            <SummaryRow
              label="Store credit"
              value={-totals.storeCreditUsedCents}
            />
          )}
          <div
            style={{
              borderTop: "1px solid var(--gg-line)",
              margin: "0.5rem 0",
              paddingTop: "0.5rem",
            }}
          >
            <SummaryRow label="Amount due" value={totals.amountDueCents} strong />
          </div>

          {totals.amountDueCents > 0 && (isStripeConfigured || isPayPalConfigured) && (
            <p className="gg-card-meta" style={{ margin: "0.5rem 0 0" }}>
              Pay by{" "}
              {[isStripeConfigured && "card", isPayPalConfigured && "PayPal or Venmo"]
                .filter(Boolean)
                .join(", ")}{" "}
              on the next step.
            </p>
          )}

          {totals.amountDueCents > 0 && !isStripeConfigured && !isPayPalConfigured && (
            <p className="gg-alert gg-alert-warn" style={{ fontSize: "0.85rem" }}>
              Online payment isn&rsquo;t live yet. Placing this order reserves your
              cards as <strong>pending</strong>; you won&rsquo;t be charged now.
            </p>
          )}

          <button
            className="gg-btn"
            style={{ width: "100%", marginTop: "0.5rem" }}
            disabled={placing || !addressValid}
            onClick={placeOrder}
          >
            {placing
              ? "Placing…"
              : totals.amountDueCents === 0
                ? "Place order (store credit)"
                : isStripeConfigured || isPayPalConfigured
                  ? "Continue to payment"
                  : "Place order"}
          </button>
          <p className="gg-card-meta" style={{ marginTop: "0.5rem" }}>
            Final totals are confirmed by our server; stock is re-checked when you
            place the order.
          </p>
        </aside>
      </div>
    </div>
  );
}

function StripePaymentForm({
  dueCents,
  onPaid,
}: {
  dueCents: number;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setCardError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        // Only used if a payment step has to leave the page (rare for
        // cards); confirmPayment() resolves in place otherwise because of
        // redirect: "if_required" above.
        return_url: `${window.location.origin}/checkout`,
      },
    });
    if (confirmError) {
      setCardError(
        confirmError.message ??
          "Payment failed. Please check your card details and try again.",
      );
      setSubmitting(false);
      return;
    }
    if (
      paymentIntent &&
      (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")
    ) {
      onPaid();
      return;
    }
    setCardError("Payment could not be completed. Please try a different payment method.");
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="gg-form" style={{ maxWidth: 480, marginTop: "1rem" }}>
      <PaymentElement />
      {cardError && (
        <div className="gg-alert gg-alert-error" role="alert" style={{ marginTop: "1rem" }}>
          {cardError}
        </div>
      )}
      <button
        className="gg-btn"
        style={{ width: "100%", marginTop: "1rem" }}
        disabled={!stripe || !elements || submitting}
        type="submit"
      >
        {submitting ? "Processing…" : `Pay ${formatCents(dueCents)}`}
      </button>
    </form>
  );
}

// PayPal + Venmo buttons for an already-created order. PayPal's SDK decides
// which buttons render: Venmo only appears for eligible US buyers (on mobile,
// or as a QR code on desktop). Cards stay with Stripe, so PayPal's own card
// button is disabled when Stripe is available to avoid two card forms.
function PayPalPaymentButtons({
  orderId,
  onPaid,
  onPending,
  onError,
}: {
  orderId: string;
  onPaid: () => void;
  onPending: () => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  // PayPal's SDK wraps errors thrown from createOrder in its own generic
  // error, so keep our customer-facing message here for onError to show.
  const lastErrorRef = useRef<string | null>(null);

  const call = async (payload: Record<string, unknown>) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Please sign in to check out.");
    const res = await fetch("/api/checkout/paypal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      body: JSON.stringify({ orderId, ...payload }),
    });
    const body = await res.json().catch(() => null);
    return { res, body };
  };

  return (
    <div style={{ maxWidth: 480, marginTop: "1rem", position: "relative" }} aria-busy={busy}>
      <PayPalScriptProvider
        options={{
          clientId: paypalClientId,
          currency: "USD",
          intent: "capture",
          components: "buttons",
          enableFunding: "venmo",
          ...(isStripeConfigured ? { disableFunding: "card" } : {}),
        }}
      >
        <PayPalButtons
          style={{ layout: "vertical", shape: "rect" }}
          disabled={busy}
          createOrder={async () => {
            onError(null);
            lastErrorRef.current = null;
            const { res, body } = await call({ action: "create" });
            if (!res.ok || !body?.ok || !body.paypalOrderId) {
              const message: string = body?.message || "PayPal couldn’t start. Please try again.";
              lastErrorRef.current = message;
              throw new Error(message);
            }
            return body.paypalOrderId as string;
          }}
          onApprove={async (data, actions) => {
            setBusy(true);
            try {
              const { res, body } = await call({
                action: "capture",
                paypalOrderId: data.orderID,
              });
              if (res.ok && body?.outcome === "paid") {
                onPaid();
                return;
              }
              if (res.ok && body?.outcome === "pending") {
                onPending();
                return;
              }
              if (body?.outcome === "declined" && body.retryable) {
                // Re-opens PayPal so the buyer can pick another funding source.
                await actions.restart();
                return;
              }
              onError(body?.message || "We couldn’t confirm your payment. Please contact us.");
            } catch {
              onError(
                "We couldn’t confirm your payment. Please check your order in your account before trying again.",
              );
            } finally {
              setBusy(false);
            }
          }}
          onCancel={() => onError(null)}
          onError={(err) => {
            console.error("[paypal] button error", err);
            onError(
              lastErrorRef.current ??
                "PayPal ran into a problem. Please try again or use another payment method.",
            );
          }}
        />
      </PayPalScriptProvider>
      {busy && (
        <p className="gg-card-meta" role="status" style={{ textAlign: "center" }}>
          Confirming your payment…
        </p>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "0.15rem 0",
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span>{label}</span>
      <span>{formatCents(value)}</span>
    </div>
  );
}

function friendlyCheckoutError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("insufficient stock") || m.includes("stock_conflict"))
    return "Some items just sold out or changed availability. Your cart was updated — please review and try again.";
  if (m.includes("no price"))
    return "One of your items isn’t priced and can’t be purchased right now.";
  if (m.includes("cart is empty")) return "Your cart is empty.";
  if (m.includes("not authenticated") || m.includes("session expired"))
    return "Please sign in to check out.";
  return "Checkout could not be completed. Please try again.";
}
