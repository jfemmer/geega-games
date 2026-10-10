import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import {
  FUNDING,
  PayPalButtons,
  PayPalScriptProvider,
  usePayPalScriptReducer,
  type PayPalButtonsComponentProps,
} from "@paypal/react-paypal-js";
import { supabase } from "../../supabase";
import { useAuth } from "../lib/AuthContext";
import GoogleAddressAutocomplete, {
  type ShippingAddressFields,
} from "../components/GoogleAddressAutocomplete";
import { useCart } from "../lib/CartContext";
import { rememberClaim } from "../lib/guestClaims";
import { authLinkWithReturn } from "../lib/authRedirect";
import { Link, useRouter } from "../lib/router";
import { getStripePromise, isStripeConfigured } from "../lib/stripeClient";
import { isPayPalConfigured, paypalClientId } from "../lib/paypalClient";
import { formatReopenDate, refreshStoreStatus, useStoreStatus } from "../lib/storeStatus";
import { ShippingMethodPicker } from "../components/ShippingMethodPicker";
import { UsStateSelect } from "../components/UsStateSelect";
import { useReveal } from "../lib/useReveal";
import {
  SHIPS_TO_SUMMARY,
  SHIP_TO_COUNTRY,
  US_ONLY_MESSAGE,
  US_ZIP_MESSAGE,
  checkUsAddress,
  isUsCountry,
  usStateFor,
  usZip,
} from "../lib/usAddress";
import {
  MEMBER_DISCOUNT_PERCENT,
  effectiveShippingMethod,
  formatCents,
  formatShipping,
  memberDiscountCents,
  previewOrderTotals,
  type ShippingMethod,
} from "../lib/money";

// Checkout. The SERVER is the only pricing authority:
//   - checkout_create_order (called via /api/checkout/create-payment-intent)
//     atomically revalidates SELLABLE stock (physical minus active
//     reservations) and computes the canonical amount due. The totals shown
//     below are display-only previews, never trusted for money.
//   - Orders ship within the United States only (../lib/usAddress.ts). The
//     form offers only US states, territories and military mail, the server
//     refuses anything else, and so does the database.
//   - Free shipping is the server's rule too: an order with enough cards
//     (SHIPPING.freeShippingThresholdCents) is created tracked with $0
//     shipping whatever this page sends. The page mirrors that so the
//     customer sees it before paying (ShippingMethodPicker, `shipMethod`).
//   - So is the member discount: a signed-in customer's cards are
//     MEMBER_DISCOUNT_PERCENT off, taken by the database from whoever's
//     session placed the order. The page shows it (and, to a guest, what
//     signing in would save) but never sends it.
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
// Guests can check out without an account (online payment required): the
// server builds their order from the browser cart's inventory ids and hands
// back a signed guest token for it (api/_lib/guestAccess.ts). That token is
// what lets this page pay for, and poll, the guest's own order, and what
// attaches it to an account if they create one on the confirmation screen.
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

/** A guest's pending order in this tab: what's needed to pay for / track it. */
type GuestOrderAccess = { orderId: string; token: string; email: string };

const GUEST_ORDER_KEY = "gg_guest_checkout";

function loadGuestOrder(): GuestOrderAccess | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(GUEST_ORDER_KEY) ?? "null");
    return v && typeof v.orderId === "string" && typeof v.token === "string" && typeof v.email === "string"
      ? (v as GuestOrderAccess)
      : null;
  } catch {
    return null;
  }
}

function saveGuestOrder(v: GuestOrderAccess | null): void {
  try {
    if (v) sessionStorage.setItem(GUEST_ORDER_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(GUEST_ORDER_KEY);
  } catch {
    /* storage blocked — only affects the rare Stripe redirect return */
  }
}

const orderNumberFor = (orderId: string) => `GG-${orderId.slice(0, 8).toUpperCase()}`;

function trackOrderLink(orderId: string, guest: GuestOrderAccess | null): string {
  return guest
    ? `/track-order?order=${encodeURIComponent(orderNumberFor(orderId))}&email=${encodeURIComponent(guest.email)}`
    : `/account/orders/${orderId}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Polls the order's payment_status until it leaves "unpaid" or attempts run out. */
async function pollPaymentStatus(
  orderId: string,
  guest: GuestOrderAccess | null,
  attempts = 6,
  intervalMs = 2000,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    await sleep(intervalMs);
    let status: string | null = null;
    if (guest) {
      // Guests can't read orders directly (RLS); the guest lookup can.
      const { data } = await supabase.rpc("guest_order_lookup", {
        p_order_number: orderId.slice(0, 8),
        p_email: guest.email,
      });
      status = (data as { payment_status?: string } | null)?.payment_status ?? null;
    } else {
      const { data } = await supabase
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .maybeSingle();
      status = data?.payment_status ?? null;
    }
    if (status && status !== "unpaid") return status === "paid";
  }
  return false;
}

export default function CheckoutPage() {
  const { user, loading: authLoading } = useAuth();
  const { lines, subtotalCents, loading: cartLoading, refresh, clear } = useCart();
  useRouter();
  const storeStatus = useStoreStatus();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddr, setSelectedAddr] = useState<string | "new">("new");
  const [form, setForm] = useState<Partial<Address>>({ country: SHIP_TO_COUNTRY });
  // Said when the address lookup is given somewhere we don't ship.
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  // The ZIP hint waits until the customer has left the field.
  const [zipTouched, setZipTouched] = useState(false);
  const handleAddressSelect = useCallback((address: ShippingAddressFields) => {
    if (!isUsCountry(address.country)) {
      // Not somewhere we ship: say so and leave the form as it was.
      setLookupNotice(US_ONLY_MESSAGE);
      return;
    }
    setLookupNotice(null);
    setForm((f) => ({
      ...f,
      line1: address.line1,
      line2: address.line2 || f.line2 || "",
      city: address.city,
      // Google lists the territories as countries ("PR"); to the Postal
      // Service they are states.
      state: usStateFor(address.state, address.country) ?? "",
      postal_code: usZip(address.postalCode) ?? address.postalCode,
      country: SHIP_TO_COUNTRY,
    }));
  }, []);
  const [method, setMethod] = useState<ShippingMethod>("tracked");
  const [creditBalance, setCreditBalance] = useState(0);
  const [useCredit, setUseCredit] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The message is at the top of the page and the button at the bottom: on a
  // phone it has to be brought into view, or the tap seems to do nothing.
  const [errorRef, revealError] = useReveal<HTMLDivElement>();

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
  // Guest checkout: their email, and access to the order they just placed.
  const [guestEmail, setGuestEmail] = useState("");
  const [guestOrder, setGuestOrder] = useState<GuestOrderAccess | null>(null);
  const isGuest = !authLoading && !user;

  // Handles a return trip to return_url: Stripe appends
  // payment_intent_client_secret when a payment step (rarely, for cards —
  // e.g. some bank authentication flows) had to leave the page.
  // We never trust anything else in the URL — the PaymentIntent's own status,
  // read back from Stripe, is the only thing that decides what happens next.
  const handledReturnRef = useRef(false);
  useEffect(() => {
    if (handledReturnRef.current || authLoading) return;
    const params = new URLSearchParams(window.location.search);
    const returnedSecret = params.get("payment_intent_client_secret");
    const intentId = params.get("payment_intent");
    if (!returnedSecret || !intentId) return;
    handledReturnRef.current = true;
    window.history.replaceState({}, "", window.location.pathname);

    (async () => {
      const token = user ? await getAccessToken() : null;
      const guest = user ? null : loadGuestOrder();
      const genericError =
        "We couldn't confirm your payment. Please contact us and reference your order.";
      if (!token && !guest) {
        setError(genericError);
        return;
      }
      if (guest) setGuestOrder(guest);
      const res = await fetch(
        token
          ? `/api/checkout/payment-intent-status?id=${encodeURIComponent(intentId)}`
          : `/api/checkout/payment-intent-status?id=${encodeURIComponent(intentId)}&orderId=${encodeURIComponent(guest!.orderId)}&guestToken=${encodeURIComponent(guest!.token)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          credentials: "same-origin",
        },
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
        if (orderId) await handlePaid(orderId, guest);
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
  }, [user, authLoading]);

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

  // How the order will really ship: the customer's pick, unless the cart
  // qualifies for free shipping, which is always tracked.
  const shipMethod = effectiveShippingMethod(method, subtotalCents);

  const totals = useMemo(
    () =>
      previewOrderTotals({
        subtotalCents,
        method: shipMethod,
        member: !!user,
        storeCreditBalanceCents: creditBalance,
        storeCreditRequestedCents: useCredit ? creditBalance : 0,
      }),
    [subtotalCents, shipMethod, user, creditBalance, useCredit],
  );
  // What signing in would take off this order, for a guest.
  const guestSavingsCents = isGuest ? memberDiscountCents(subtotalCents) : 0;

  const chosenAddress: Partial<Address> | null =
    selectedAddr === "new"
      ? form
      : addresses.find((a) => a.id === selectedAddr) ?? null;

  const addressComplete =
    !!chosenAddress &&
    !!chosenAddress.line1?.trim() &&
    !!chosenAddress.city?.trim() &&
    !!chosenAddress.state &&
    !!chosenAddress.postal_code?.trim() &&
    // Guests have no profile to name the package after.
    (!isGuest || !!chosenAddress.recipient?.trim());
  // Is it somewhere we ship? (US only: see ../lib/usAddress.ts.)
  const addressCheck = chosenAddress
    ? checkUsAddress({
        state: chosenAddress.state,
        postalCode: chosenAddress.postal_code,
        country: chosenAddress.country,
      })
    : null;
  const addressValid = addressComplete && addressCheck?.ok === true;
  // The address as it is sent and saved: trimmed, state as its USPS code.
  const shipTo =
    chosenAddress && addressCheck?.ok
      ? {
          recipient: chosenAddress.recipient?.trim() || null,
          line1: (chosenAddress.line1 ?? "").trim(),
          line2: chosenAddress.line2?.trim() || null,
          city: (chosenAddress.city ?? "").trim(),
          state: addressCheck.state,
          postalCode: addressCheck.postalCode,
          country: addressCheck.country,
        }
      : null;
  // Typing in the form: also clears a "we don't ship there" note left by the
  // address lookup, which is no longer about what's in the fields.
  const editAddress = (patch: Partial<Address>) => {
    setLookupNotice(null);
    setForm((s) => ({ ...s, ...patch }));
  };
  // A saved address from before the US-only rule that can't be shipped to.
  const savedAddressProblem =
    selectedAddr !== "new" && addressComplete && addressCheck && !addressCheck.ok ? addressCheck.message : null;
  const zipInvalid = zipTouched && !!form.postal_code?.trim() && usZip(form.postal_code) === null;
  const guestEmailValid = EMAIL_RE.test(guestEmail.trim());
  const canPayOnline = isStripeConfigured || isPayPalConfigured;

  const placeOrder = async () => {
    setError(null);
    const fail = (message: string) => {
      setError(message);
      revealError();
    };
    if (isGuest && !guestEmailValid) {
      fail("Please enter your email so we can send your receipt and tracking.");
      return;
    }
    if (!addressComplete) {
      fail(
        isGuest
          ? "Please enter the recipient's name and a complete shipping address."
          : "Please provide a complete shipping address.",
      );
      return;
    }
    if (!shipTo) {
      fail(addressCheck && !addressCheck.ok ? addressCheck.message : US_ONLY_MESSAGE);
      return;
    }
    setPlacing(true);
    try {
      // Re-check vacation mode right before ordering (the page may have been
      // open since before it was switched on). The server enforces it too.
      if ((await refreshStoreStatus()).ordersPaused) return;

      // Persist a new address if entered inline (so it's saved for reuse).
      if (selectedAddr === "new" && user) {
        await supabase.from("addresses").insert({
          user_id: user.id,
          recipient: shipTo.recipient,
          line1: shipTo.line1,
          line2: shipTo.line2,
          city: shipTo.city,
          state: shipTo.state,
          postal_code: shipTo.postalCode,
          country: shipTo.country,
          // Signup no longer asks for an address, so the first one saved
          // here becomes the default for next time.
          is_default: addresses.length === 0,
        });
      }

      // Any online payment method → the server creates the order (and the
      // Stripe PaymentIntent, when Stripe is configured) and first releases
      // this customer's earlier unpaid checkout holds.
      if (canPayOnline) {
        await placeOrderViaServer(shipTo);
      } else if (user) {
        await placeOrderLegacy(shipTo);
      } else {
        throw new Error("Please sign in to place this order.");
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setPlacing(false);
    }
  };

  // Online-payment path: server creates the canonical order AND (if a
  // balance is due and Stripe is configured) a PaymentIntent for exactly
  // that amount, in one call. The cart is NOT emptied here — the order only
  // holds its cards for a limited time, and the cart is cleared once the
  // order is actually paid (mark_order_paid).
  const placeOrderViaServer = async (to: NonNullable<typeof shipTo>) => {
    const token = user ? await getAccessToken() : null;
    if (user && !token) throw new Error("Your session expired. Please sign in again.");
    const email = guestEmail.trim();
    const previous = token ? null : loadGuestOrder();
    const res = await fetch("/api/checkout/create-payment-intent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify({
        shippingMethod: shipMethod,
        storeCreditRequestedCents: token && useCredit ? creditBalance : 0,
        // Guests: the server re-prices these ids from inventory; only ids
        // and quantities are sent, never prices.
        guest: token
          ? undefined
          : {
              email,
              items: lines.map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: l.quantity })),
              previousOrder: previous ? { id: previous.orderId, token: previous.token } : undefined,
            },
        ship: {
          recipient: to.recipient ?? undefined,
          line1: to.line1,
          line2: to.line2 ?? undefined,
          city: to.city,
          state: to.state,
          postalCode: to.postalCode,
          country: to.country,
        },
      }),
    });
    const body = await res.json().catch(() => null);
    // A guest order (even one whose card payment couldn't start) comes with
    // its access token — keep it for paying, polling, and linking to an account.
    if (!token && body?.orderId && typeof body.guestToken === "string") {
      const access = { orderId: body.orderId as string, token: body.guestToken as string, email };
      setGuestOrder(access);
      saveGuestOrder(access);
      rememberClaim({ kind: "order", id: access.orderId, token: access.token });
    }
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
      if (body?.code === "orders_paused") {
        await refreshStoreStatus(); // shows the banner/notice with the store's message
        throw new Error(body.message || friendlyCheckoutError("orders paused"));
      }
      if (body?.code === "shipping_address" && typeof body.message === "string") {
        // The server's own words: which part of the address it can't ship to.
        throw new Error(body.message);
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
  const placeOrderLegacy = async (to: NonNullable<typeof shipTo>) => {
    const { data, error: rpcError } = await supabase.rpc("checkout_create_order", {
      p_shipping_method: shipMethod,
      p_store_credit_requested_cents: useCredit ? creditBalance : 0,
      p_ship_recipient: to.recipient,
      p_ship_line1: to.line1,
      p_ship_line2: to.line2,
      p_ship_city: to.city,
      p_ship_state: to.state,
      p_ship_postal_code: to.postalCode,
      p_ship_country: to.country,
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

  const handlePaid = async (orderId: string, guestOverride?: GuestOrderAccess | null) => {
    const guest = guestOverride !== undefined ? guestOverride : guestOrder;
    setConfirmingPayment(true);
    await pollPaymentStatus(orderId, guest);
    // Whether or not the webhook had already landed by the time polling
    // stopped, the payment itself succeeded (Stripe confirmed it to us) —
    // the order page will always show the true DB state either way.
    setConfirmingPayment(false);
    setCardPaymentDone(true);
    if (guest) {
      // A guest's cart lives only in this browser; the order now has it all.
      await clear();
      saveGuestOrder(null);
    } else {
      // mark_order_paid removed the purchased cards from the cart.
      await refresh();
    }
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
          Your order is paid and confirmed. Order {orderNumberFor(placedOrderId)}.
          {guestOrder && <> We emailed your receipt to <strong>{guestOrder.email}</strong>.</>}
        </p>
        <Link to={trackOrderLink(placedOrderId, guestOrder)} className="gg-btn">
          {guestOrder ? "Track this order" : "View order"}
        </Link>
        {guestOrder && !user && (
          <SaveOrderToAccount
            guest={guestOrder}
            recipient={chosenAddress?.recipient ?? ""}
          />
        )}
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
        <Link to={trackOrderLink(placedOrderId, guestOrder)} className="gg-btn">
          View order
        </Link>
      </div>
    );
  }

  if (placedOrderId && awaitingPayment && !confirmingPayment) {
    return (
      <div className="gg-page">
        <div className="gg-pay">
          <button type="button" className="gg-pay-back" onClick={backToCheckout}>
            ← Back to checkout
          </button>
          <h1 className="gg-pay-title">Payment</h1>
          <div className="gg-pay-total">
            <span>Amount due</span>
            <strong>{formatCents(dueCents)}</strong>
          </div>
          <p className="gg-card-meta gg-pay-note">
            Order #{placedOrderId.slice(0, 8).toUpperCase()} — we&rsquo;re holding your
            cards for {CHECKOUT_HOLD_MINUTES} minutes. If you don&rsquo;t finish, they go
            back on sale and stay in your cart.
          </p>
          {error && (
            <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          {isPayPalConfigured && (
            <PayPalPaymentButtons
              orderId={placedOrderId}
              guestToken={guestOrder?.orderId === placedOrderId ? guestOrder.token : null}
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
          {clientSecret && dueCents > 0 && (
            // The form is configured for cards only HERE, independent of the
            // PaymentIntent, so methods switched on in the Stripe Dashboard
            // (Klarna, bank payments, Cash App, Link, ...) can never appear.
            // The PaymentIntent is attached at confirm time (clientSecret).
            <Elements
              stripe={getStripePromise()}
              options={{
                mode: "payment",
                amount: dueCents,
                currency: "usd",
                paymentMethodTypes: ["card"],
              }}
            >
              <StripePaymentForm
                clientSecret={clientSecret}
                dueCents={dueCents}
                onPaid={() => handlePaid(placedOrderId)}
              />
            </Elements>
          )}
        </div>
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
        <Link to={trackOrderLink(placedOrderId, guestOrder)} className="gg-btn">
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

  return (
    <div className="gg-page">
      <h1 style={{ color: "var(--gg-ink)" }}>Checkout</h1>
      {error && (
        <div ref={errorRef} className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      <div className="gg-shop">
        <div>
          {isGuest && (
            <section className="gg-guest-checkout" aria-labelledby="gg-guest-h">
              <h2 id="gg-guest-h" style={{ marginTop: 0 }}>Contact</h2>
              <div className="gg-field">
                <label htmlFor="co-email">Email for your receipt &amp; tracking</label>
                <input
                  id="co-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                />
              </div>
              <p className="gg-card-meta" style={{ margin: "0.25rem 0 0" }}>
                Checking out as a guest — no account needed.{" "}
                <Link to={authLinkWithReturn("/login")}>Sign in</Link> to save{" "}
                {MEMBER_DISCOUNT_PERCENT}% and use saved addresses and store credit.
              </p>
            </section>
          )}
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
          {savedAddressProblem && (
            <div className="gg-alert gg-alert-warn" role="alert">
              We can&rsquo;t ship to this saved address. {savedAddressProblem} Choose another
              address or enter a new one.
            </div>
          )}
          {selectedAddr === "new" && (
            <div className="gg-form" style={{ margin: "0.5rem 0 0", maxWidth: "none" }}>
              <GoogleAddressAutocomplete label="Find your address" onSelect={handleAddressSelect} />
              {lookupNotice && (
                <div className="gg-alert gg-alert-warn" role="alert">
                  {lookupNotice}
                </div>
              )}
              {(
                [
                  ["recipient", "Recipient", "shipping name"],
                  ["line1", "Address line 1", "shipping address-line1"],
                  ["line2", "Address line 2 (optional)", "shipping address-line2"],
                  ["city", "City", "shipping address-level2"],
                ] as const
              ).map(([field, label, autoComplete]) => (
                <div className="gg-field" key={field}>
                  <label htmlFor={`co-${field}`}>{label}</label>
                  <input
                    id={`co-${field}`}
                    autoComplete={autoComplete}
                    value={(form[field] as string) ?? ""}
                    onChange={(e) => editAddress({ [field]: e.target.value })}
                  />
                </div>
              ))}
              {/* No country to choose: we ship within the United States only,
                  so the state list is the whole choice. */}
              <div className="gg-field">
                <label htmlFor="co-state">State</label>
                <UsStateSelect
                  id="co-state"
                  autoComplete="shipping address-level1"
                  value={form.state}
                  onChange={(code) => editAddress({ state: code })}
                />
              </div>
              <div className="gg-field">
                <label htmlFor="co-postal_code">ZIP code</label>
                <input
                  id="co-postal_code"
                  autoComplete="shipping postal-code"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.postal_code ?? ""}
                  onChange={(e) => editAddress({ postal_code: e.target.value })}
                  onBlur={() => setZipTouched(true)}
                  aria-invalid={zipInvalid || undefined}
                  aria-describedby={zipInvalid ? "co-zip-hint" : undefined}
                />
                {zipInvalid && (
                  <p id="co-zip-hint" className="gg-field-error" role="alert">
                    {US_ZIP_MESSAGE}
                  </p>
                )}
              </div>
              <p className="gg-card-meta gg-ship-note">{SHIPS_TO_SUMMARY}</p>
            </div>
          )}

          {/* Shipping method */}
          <h2 style={{ marginTop: "1.5rem" }}>Shipping method</h2>
          <ShippingMethodPicker subtotalCents={subtotalCents} method={method} onChange={setMethod} />
        </div>

        {/* Summary */}
        <aside className="gg-filters" style={{ alignSelf: "start" }}>
          <h2 style={{ marginTop: 0 }}>Summary</h2>
          <SummaryRow label="Subtotal" value={totals.subtotalCents} />
          {totals.discountCents > 0 && (
            <SummaryRow
              label={`Member discount (${MEMBER_DISCOUNT_PERCENT}%)`}
              value={-totals.discountCents}
            />
          )}
          {guestSavingsCents > 0 && (
            <p className="gg-member-nudge">
              <Link to={authLinkWithReturn("/login")}>Sign in</Link> or{" "}
              <Link to={authLinkWithReturn("/signup")}>create a free account</Link> to save{" "}
              <strong>{formatCents(guestSavingsCents)}</strong> on this order —{" "}
              {MEMBER_DISCOUNT_PERCENT}% off every order when you&rsquo;re signed in.
            </p>
          )}
          <SummaryRow
            label="Shipping"
            value={totals.shippingCents}
            text={formatShipping(totals.shippingCents)}
          />
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

          {storeStatus.ordersPaused && (
            <p className="gg-paused-note" role="status" style={{ marginTop: "0.75rem" }}>
              {storeStatus.message}
              {storeStatus.pausedUntil && (
                <> Checkout reopens {formatReopenDate(storeStatus.pausedUntil)}.</>
              )}
            </p>
          )}

          <button
            className="gg-btn"
            style={{ width: "100%", marginTop: "0.5rem" }}
            disabled={
              placing ||
              !addressValid ||
              (isGuest && (!guestEmailValid || !canPayOnline)) ||
              storeStatus.ordersPaused
            }
            onClick={placeOrder}
          >
            {storeStatus.ordersPaused
              ? "Checkout paused"
              : placing
                ? "Placing…"
                : totals.amountDueCents === 0
                  ? "Place order (store credit)"
                  : isStripeConfigured || isPayPalConfigured
                    ? "Continue to payment"
                    : "Place order"}
          </button>
          {isGuest && !canPayOnline && (
            <p className="gg-alert gg-alert-warn" style={{ fontSize: "0.85rem" }}>
              Online payment isn&rsquo;t live yet, so orders need an account for now.{" "}
              <Link to={authLinkWithReturn("/login")}>Sign in</Link>
            </p>
          )}
          <p className="gg-card-meta" style={{ marginTop: "0.5rem" }}>
            Final totals are confirmed by our server; stock is re-checked when you
            place the order.
          </p>
        </aside>
      </div>
    </div>
  );
}

/**
 * Post-purchase account creation for a guest: one password field (email and
 * name are already known from the order). The order was remembered as a
 * pending claim when it was placed, so AuthContext links it to the account
 * as soon as there's a session — now, or after email confirmation.
 */
function SaveOrderToAccount({ guest, recipient }: { guest: GuestOrderAccess; recipient: string }) {
  const { user, signUp } = useAuth();
  const [first, ...rest] = recipient.trim().split(/\s+/);
  const [firstName, setFirstName] = useState(first ?? "");
  const [lastName, setLastName] = useState(rest.join(" "));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  if (user) {
    return (
      <div className="gg-save-order gg-alert gg-alert-ok" role="status">
        Your account is ready and this order is saved in it.{" "}
        <Link to="/account/orders">See your orders</Link>
      </div>
    );
  }
  if (checkEmail) {
    return (
      <div className="gg-save-order gg-alert gg-alert-ok" role="status">
        Almost done — check {guest.email} for a link to confirm your account. This order
        will be added as soon as you sign in.
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setExisting(false);
    if (password.length < 6) {
      setError("Please choose a password with at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const { needsEmailConfirmation } = await signUp({
        email: guest.email,
        password,
        firstName,
        lastName,
      });
      if (needsEmailConfirmation) setCheckEmail(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn’t create your account.";
      setExisting(/already exists/i.test(message));
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gg-save-order gg-form" onSubmit={submit}>
      <h2>Save {MEMBER_DISCOUNT_PERCENT}% on your next order</h2>
      <p className="gg-card-meta">
        Create a free account and every order you place signed in is {MEMBER_DISCOUNT_PERCENT}%
        off. This order is saved to it, and you&rsquo;ll get emailed when cards on your wishlist
        restock or drop in price.
      </p>
      <p className="gg-card-meta" style={{ margin: 0 }}>
        Account email: <strong>{guest.email}</strong>
      </p>
      <div className="gg-form-grid">
        <div className="gg-field">
          <label htmlFor="so-first">First name</label>
          <input id="so-first" autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="gg-field">
          <label htmlFor="so-last">Last name</label>
          <input id="so-last" autoComplete="family-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="gg-field">
        <label htmlFor="so-pw">Choose a password</label>
        <input
          id="so-pw"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <div className="gg-alert gg-alert-error" role="alert">
          {error}
          {existing && (
            <>
              {" "}
              <Link to="/login?next=/account/orders">Sign in to add this order to it</Link>
            </>
          )}
        </div>
      )}
      <button className="gg-btn" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}

function StripePaymentForm({
  clientSecret,
  dueCents,
  onPaid,
}: {
  clientSecret: string;
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
    // Required before confirmPayment when the Elements group was created
    // without a clientSecret: validates the card fields.
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
    <form onSubmit={handleSubmit} className="gg-form gg-pay-card">
      <PaymentElement />
      {cardError && (
        <div className="gg-alert gg-alert-error" role="alert">
          {cardError}
        </div>
      )}
      <button
        className="gg-btn"
        disabled={!stripe || !elements || submitting}
        type="submit"
      >
        {submitting ? "Processing…" : `Pay ${formatCents(dueCents)}`}
      </button>
    </form>
  );
}

// PayPal + Venmo buttons for an already-created order.
//
// Each funding source is its own standalone button (rather than PayPal's
// default stacked group) so we control exactly which ones appear and they
// all share one size and shape:
//   - PayPal: always.
//   - Venmo: rendered only when PayPal says the buyer is eligible (US, and
//     mostly on phones; desktop gets a QR code). Ineligible → no button.
//   - Pay Later / PayPal Credit: never (disabled at the SDK level too).
//   - Card: only when Stripe isn't configured, so there's never a second
//     card form next to Stripe's.
const WALLET_BUTTON_STYLE = {
  layout: "horizontal",
  shape: "rect",
  borderRadius: 8,
  height: 45,
  tagline: false,
} as const;
const PAYPAL_BUTTON_STYLE = { ...WALLET_BUTTON_STYLE, color: "gold" } as const;
const VENMO_BUTTON_STYLE = { ...WALLET_BUTTON_STYLE, color: "blue" } as const;
const CARD_BUTTON_STYLE = { ...WALLET_BUTTON_STYLE, color: "black" } as const;

const PAYPAL_DISABLED_FUNDING = ["paylater", "credit", ...(isStripeConfigured ? ["card"] : [])].join(",");

function PayPalPaymentButtons({
  orderId,
  guestToken,
  onPaid,
  onPending,
  onError,
}: {
  orderId: string;
  /** Set for a guest's order: proves this browser placed it (no account token). */
  guestToken: string | null;
  onPaid: () => void;
  onPending: () => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  // PayPal's SDK wraps errors thrown from createOrder in its own generic
  // error, so keep our customer-facing message here for onError to show.
  const lastErrorRef = useRef<string | null>(null);

  const call = async (payload: Record<string, unknown>) => {
    const token = guestToken ? null : await getAccessToken();
    if (!token && !guestToken) throw new Error("Your session expired. Please sign in again.");
    const res = await fetch("/api/checkout/paypal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify({ orderId, ...(guestToken ? { guestToken } : {}), ...payload }),
    });
    const body = await res.json().catch(() => null);
    return { res, body };
  };

  // Shared by every button: they all pay the same order the same way.
  const handlers: PayPalButtonsComponentProps = {
    disabled: busy,
    createOrder: async () => {
      onError(null);
      lastErrorRef.current = null;
      const { res, body } = await call({ action: "create" });
      if (!res.ok || !body?.ok || !body.paypalOrderId) {
        const message: string = body?.message || "PayPal couldn’t start. Please try again.";
        lastErrorRef.current = message;
        throw new Error(message);
      }
      return body.paypalOrderId as string;
    },
    onApprove: async (data, actions) => {
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
    },
    onCancel: () => onError(null),
    onError: (err) => {
      console.error("[paypal] button error", err);
      onError(
        lastErrorRef.current ??
          "PayPal ran into a problem. Please try again or use another payment method.",
      );
    },
  };

  return (
    <div className="gg-pay-wallets" aria-busy={busy}>
      <PayPalScriptProvider
        options={{
          clientId: paypalClientId,
          currency: "USD",
          intent: "capture",
          components: "buttons",
          enableFunding: "venmo",
          disableFunding: PAYPAL_DISABLED_FUNDING,
        }}
      >
        <WalletButtons handlers={handlers} />
      </PayPalScriptProvider>
      {busy && (
        <p className="gg-card-meta gg-pay-status" role="status">
          Confirming your payment…
        </p>
      )}
    </div>
  );
}

// Must render inside PayPalScriptProvider (reads its loading state).
function WalletButtons({ handlers }: { handlers: PayPalButtonsComponentProps }) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();

  if (isRejected) {
    return (
      <p className="gg-card-meta gg-pay-status">
        PayPal and Venmo couldn&rsquo;t load. Refresh the page
        {isStripeConfigured ? " or pay by card below" : " to try again"}.
      </p>
    );
  }
  if (isPending) {
    // Holds the PayPal button's space so the page doesn't jump when it loads.
    return <div className="gg-pay-skeleton" aria-label="Loading PayPal" />;
  }
  return (
    <>
      <PayPalButtons {...handlers} fundingSource={FUNDING.PAYPAL} style={PAYPAL_BUTTON_STYLE} />
      <PayPalButtons {...handlers} fundingSource={FUNDING.VENMO} style={VENMO_BUTTON_STYLE} />
      {!isStripeConfigured && (
        <PayPalButtons {...handlers} fundingSource={FUNDING.CARD} style={CARD_BUTTON_STYLE} />
      )}
    </>
  );
}

function SummaryRow({
  label,
  value,
  text,
  strong,
}: {
  label: string;
  value: number;
  /** Shown instead of the formatted amount (e.g. "Free" for $0 shipping). */
  text?: string;
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
      <span>{text ?? formatCents(value)}</span>
    </div>
  );
}

function friendlyCheckoutError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("orders paused"))
    return "We’re not taking orders right now. Your cart is saved — please check back soon.";
  if (m.includes("insufficient stock") || m.includes("stock_conflict"))
    return "Some items just sold out or changed availability. Your cart was updated — please review and try again.";
  if (m.includes("no price"))
    return "One of your items isn’t priced and can’t be purchased right now.";
  if (m.includes("cart is empty")) return "Your cart is empty.";
  if (m.includes("shipping address required")) return "Please provide a complete shipping address.";
  if (m.includes("us shipping only")) return `${US_ONLY_MESSAGE} Please check the state and ZIP code.`;
  if (m.includes("not authenticated") || m.includes("session expired"))
    return "Please sign in to check out.";
  return "Checkout could not be completed. Please try again.";
}
