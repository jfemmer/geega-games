import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useRouter } from "../lib/router";
import { supabase } from "../../supabase";
import { formatCents } from "../lib/money";
import { isStripeConfigured } from "../lib/stripeClient";
import { SUPPORT_EMAIL } from "./StaticPages";
import { useSEO } from "../lib/useSEO";
import {
  StatusBadge,
  OrderProgress,
  TrackingPanel,
  ContactAboutOrderLink,
  Row,
} from "./AccountPages";
import type { OrderStatus, PaymentStatus } from "../lib/orderStatus";

// Guest-facing order status lookup — no account required. Backed by
// guest_order_lookup(), a SECURITY DEFINER RPC that only resolves a row when
// BOTH the order number and the checkout email match; either alone is not
// enough (see the migration for the anti-enumeration reasoning). The result
// carries exactly the fields a signed-in customer already sees on their own
// order (AccountPages' OrderDetailSection) — this page deliberately reuses
// that same presentation via the shared StatusBadge/OrderProgress/
// TrackingPanel/Row components rather than re-implementing it.

type GuestOrderItem = {
  id: string;
  card_name: string;
  set_code: string | null;
  set_name: string | null;
  collector_number: string | null;
  condition: string;
  finish: string;
  variant_type: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  image_url: string | null;
};

type GuestOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  subtotal_cents: number;
  shipping_cents: number;
  store_credit_used_cents: number;
  total_cents: number;
  amount_due_cents: number;
  shipping_method: string;
  tracking_carrier: string | null;
  tracking_number: string | null;
  paid_at: string | null;
  packed_at: string | null;
  ready_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  ship_recipient: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_postal_code: string | null;
  ship_country: string | null;
  items: GuestOrderItem[];
};

/**
 * Accepts every way an order number is written to customers — "#AB12CD34"
 * on the site, "GG-AB12CD34" in emails — and returns the 8 characters
 * guest_order_lookup matches on.
 */
export function normalizeOrderNumber(raw: string): string {
  return raw.trim().replace(/^#/, "").replace(/^gg-/i, "").trim();
}

export default function TrackOrderPage() {
  useSEO({
    title: "Track Your Order | Geega Games",
    description:
      "Check the status of your Geega Games order using your order number and the email you used at checkout.",
    path: "/track-order",
  });

  const { query } = useRouter();
  const [orderNumberInput, setOrderNumberInput] = useState(() => query.get("order") ?? "");
  const [email, setEmail] = useState(() => query.get("email") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<{ orderNumber: string; email: string } | null>(null);
  const [order, setOrder] = useState<GuestOrder | null>(null);

  const lookup = async (orderNumber: string, lookupEmail: string) => {
    setError(null);
    setNotFound(null);
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("guest_order_lookup", {
        p_order_number: normalizeOrderNumber(orderNumber),
        p_email: lookupEmail.trim(),
      });
      if (rpcError) throw new Error(rpcError.message);
      if (!data) {
        setNotFound({ orderNumber: orderNumber.trim(), email: lookupEmail.trim() });
      } else {
        setOrder(data as GuestOrder);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await lookup(orderNumberInput, email);
  };

  // Links from the order confirmation email / guest checkout carry
  // ?order=&email= — look the order up straight away.
  const autoLookedUp = useRef(false);
  useEffect(() => {
    if (autoLookedUp.current) return;
    const o = query.get("order");
    const e = query.get("email");
    if (o && e) {
      autoLookedUp.current = true;
      void lookup(o, e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setOrder(null);
    setError(null);
    setNotFound(null);
    setOrderNumberInput("");
    setEmail("");
  };

  if (order) {
    return (
      <div className="gg-page">
        <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={reset}>
          ← Look up a different order
        </button>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "0.75rem",
            margin: "0.75rem 0 0.25rem",
          }}
        >
          <div>
            <h1 style={{ margin: "0 0 0.25rem", color: "var(--gg-ink)" }}>
              Order {order.order_number}
            </h1>
            <p className="gg-card-meta" style={{ margin: 0 }}>
              Placed {new Date(order.created_at).toLocaleString()}
            </p>
          </div>
          <ContactAboutOrderLink orderNum={order.order_number} />
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.75rem 0 1rem" }}>
          <StatusBadge status={order.status} kind="order" />
          <StatusBadge status={order.payment_status} kind="payment" />
          <span className="gg-badge">
            {order.shipping_method === "pwe" ? "Plain White Envelope" : "Tracked shipping"}
          </span>
        </div>

        <OrderProgress
          status={order.status}
          timestamps={{
            pending_payment: order.created_at,
            paid: order.paid_at,
            packing: order.packed_at,
            ready_to_ship: order.ready_at,
            shipped: order.shipped_at,
            delivered: order.delivered_at,
          }}
        />

        <h3 className="gg-detail__h3" style={{ marginTop: 0 }}>
          Track My Order
        </h3>
        <div style={{ marginBottom: "1.25rem" }}>
          <TrackingPanel
            shippingMethod={order.shipping_method}
            status={order.status}
            trackingCarrier={order.tracking_carrier}
            trackingNumber={order.tracking_number}
          />
        </div>

        <h3 className="gg-detail__h3">Items</h3>
        {order.items.map((it) => (
          <div className="gg-line" key={it.id}>
            {it.image_url && (
              <img className="gg-line-img" src={it.image_url} alt="" loading="lazy" />
            )}
            <div className="gg-line-info">
              <div className="gg-card-name">
                {it.card_name}
                {it.variant_type && (
                  <span className="gg-badge gg-badge-variant" style={{ marginLeft: "0.4rem" }}>
                    {it.variant_type}
                  </span>
                )}
              </div>
              <div className="gg-card-meta">
                {it.set_name ?? it.set_code?.toUpperCase()}
                {it.collector_number ? ` · #${it.collector_number}` : ""} · {it.condition} ·{" "}
                {it.finish} · {formatCents(it.unit_price_cents)} × {it.quantity}
              </div>
            </div>
            <div className="gg-price">{formatCents(it.line_total_cents)}</div>
          </div>
        ))}

        <div style={{ marginTop: "1.25rem", maxWidth: 320, marginLeft: "auto" }}>
          <Row label="Subtotal" value={order.subtotal_cents} />
          <Row label="Shipping" value={order.shipping_cents} />
          {order.store_credit_used_cents > 0 && (
            <Row label="Store credit" value={-order.store_credit_used_cents} />
          )}
          <Row label="Total" value={order.total_cents} strong />
          {order.amount_due_cents > 0 && order.payment_status === "unpaid" && (
            <p className="gg-alert gg-alert-warn" style={{ marginTop: "0.5rem" }}>
              Amount due: {formatCents(order.amount_due_cents)} —{" "}
              {isStripeConfigured
                ? "this order is awaiting payment. Nothing has been charged."
                : "card payment isn’t live yet, so nothing has been charged."}
            </p>
          )}
          {order.amount_due_cents > 0 && order.payment_status === "processing" && (
            <p className="gg-alert gg-alert-warn" style={{ marginTop: "0.5rem" }}>
              Amount due: {formatCents(order.amount_due_cents)} — we’re confirming your
              payment now. This page will update once it’s complete.
            </p>
          )}
        </div>

        {order.ship_recipient && (
          <div style={{ marginTop: "1.5rem" }}>
            <h3 className="gg-detail__h3">Shipping to</h3>
            <p className="gg-card-meta">
              {order.ship_recipient}
              <br />
              {order.ship_line1}
              {order.ship_line2 ? <>, {order.ship_line2}</> : null}
              <br />
              {order.ship_city}, {order.ship_state} {order.ship_postal_code}
              <br />
              {order.ship_country}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="gg-page" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center", color: "var(--gg-ink)" }}>Track Your Order</h1>
      <p className="gg-card-meta" style={{ textAlign: "center", marginTop: "-0.5rem" }}>
        Enter your order number and the email you used at checkout.
      </p>
      <form className="gg-form" onSubmit={submit} noValidate>
        {notFound ? (
          <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
            We couldn&rsquo;t find an order matching that email and order number. Double-check
            both and try again, or{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                `Order lookup help (${notFound.orderNumber})`,
              )}&body=${encodeURIComponent(
                `Hi Geega Games,\n\nI'm trying to look up an order but couldn't find a match.\n\nOrder number: ${notFound.orderNumber}\nEmail: ${notFound.email}\n\n`,
              )}`}
            >
              contact us for help
            </a>
            .
          </div>
        ) : error ? (
          <div className="gg-alert gg-alert-error" role="alert" aria-live="assertive">
            {error}
          </div>
        ) : null}
        <div className="gg-field">
          <label htmlFor="track-order-number">Order number</label>
          <input
            id="track-order-number"
            type="text"
            placeholder="#A1B2C3D4"
            autoComplete="off"
            required
            value={orderNumberInput}
            onChange={(e) => setOrderNumberInput(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="track-order-email">Email</label>
          <input
            id="track-order-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="gg-btn" type="submit" disabled={busy}>
          {busy ? "Looking up…" : "Track order"}
        </button>
      </form>
      <p className="gg-card-meta" style={{ textAlign: "center", marginTop: "1rem" }}>
        Have an account? <Link to="/login?next=/account/orders">Sign in</Link> to see your full
        order history.
      </p>
    </div>
  );
}
