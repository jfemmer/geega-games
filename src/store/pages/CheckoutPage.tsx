import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { Link, useRouter } from "../lib/router";
import {
  formatCents,
  previewOrderTotals,
  amountUntilFreeShipping,
  type ShippingMethod,
} from "../lib/money";

// Checkout. The SERVER (checkout_create_order) computes the canonical, charged
// amounts and atomically revalidates SELLABLE stock (physical minus active
// reservations) — the preview below is display-only and never trusted for money.
//
// Payment boundary: Stripe is not yet wired. An order whose amount due is $0
// after store credit is completed by the trusted zero-balance path in the RPC.
// An order with a balance due is created as pending_payment and the customer is
// told, honestly, that card payment is not live yet — we NEVER fake a payment.
//
// TO ENABLE CARD PAYMENTS (one integration point):
//   1. `npm i @stripe/stripe-js @stripe/react-stripe-js` on the client.
//   2. Replace the direct `checkout_create_order` call in placeOrder() below
//      with a POST to /api/checkout/create-payment-intent (already built,
//      server-authoritative). It returns { orderId, clientSecret } for
//      balance-due orders, or { paid: true } when store credit covered it.
//   3. Confirm the clientSecret with Stripe Elements <PaymentElement>, then on
//      success show the confirmation from the DB (the webhook marks it paid).
// Until then, the flow below creates the canonical order and stops cleanly at
// the payment boundary.

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
  const [paidComplete, setPaidComplete] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login?next=/checkout", { replace: true });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("addresses")
      .select("id, recipient, line1, line2, city, state, postal_code, country")
      .order("is_default", { ascending: false })
      .then(({ data }) => {
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

      // SERVER computes canonical totals + revalidates sellable stock atomically.
      const { data, error: rpcError } = await supabase.rpc(
        "checkout_create_order",
        {
          p_shipping_method: method,
          p_store_credit_requested_cents: useCredit ? creditBalance : 0,
          p_ship_recipient: chosenAddress?.recipient ?? null,
          p_ship_line1: chosenAddress?.line1 ?? null,
          p_ship_line2: chosenAddress?.line2 ?? null,
          p_ship_city: chosenAddress?.city ?? null,
          p_ship_state: chosenAddress?.state ?? null,
          p_ship_postal_code: chosenAddress?.postal_code ?? null,
          p_ship_country: chosenAddress?.country ?? "US",
        },
      );
      if (rpcError) throw new Error(friendlyCheckoutError(rpcError.message));
      const result = Array.isArray(data) ? data[0] : data;
      if (!result) throw new Error("Order could not be created.");

      setPlacedOrderId(result.order_id);
      await refresh(); // cart was emptied server-side

      if (result.amount_due_cents === 0) {
        // Zero-balance order was marked paid by the trusted DB path.
        setPaidComplete(true);
      }
      // else: order is pending_payment; card payment is not live yet (see UI).
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed.");
    } finally {
      setPlacing(false);
    }
  };

  if (authLoading || cartLoading) {
    return <div className="gg-page">Loading…</div>;
  }

  // ---- Confirmation states -------------------------------------------------
  if (placedOrderId && paidComplete) {
    return (
      <div className="gg-page gg-empty">
        <h1>Order confirmed 🎉</h1>
        <p>
          Your store-credit order is paid and confirmed. Order #
          {placedOrderId.slice(0, 8).toUpperCase()}.
        </p>
        <Link to={`/account/orders/${placedOrderId}`} className="gg-btn">
          View order
        </Link>
      </div>
    );
  }
  if (placedOrderId && !paidComplete) {
    return (
      <div className="gg-page gg-empty">
        <h1>Order created — payment not yet enabled</h1>
        <p>
          We created your order (#{placedOrderId.slice(0, 8).toUpperCase()}) and
          reserved your cards, but online card payment isn&rsquo;t live yet, so{" "}
          <strong>no money has been charged</strong>.
        </p>
        <p className="gg-alert gg-alert-warn" style={{ maxWidth: 560, margin: "1rem auto" }}>
          The store owner is finishing payment setup. Your order is saved as
          pending — you can view it in your account.
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
                <div className="gg-card-name">{l.name}</div>
                <div className="gg-card-meta">
                  {l.setCode?.toUpperCase()} · {l.condition} × {l.quantity}
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

          {totals.amountDueCents > 0 && (
            <p className="gg-alert gg-alert-warn" style={{ fontSize: "0.85rem" }}>
              Card payment isn&rsquo;t live yet. Placing this order reserves your
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
  if (m.includes("insufficient stock"))
    return "Some items just sold out or changed availability. Your cart was updated — please review and try again.";
  if (m.includes("no price"))
    return "One of your items isn’t priced and can’t be purchased right now.";
  if (m.includes("cart is empty")) return "Your cart is empty.";
  if (m.includes("not authenticated")) return "Please sign in to check out.";
  return "Checkout could not be completed. Please try again.";
}
