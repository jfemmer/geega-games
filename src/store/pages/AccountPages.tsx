import { useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { Link, useRouter, matchRoute } from "../lib/router";
import { formatCents } from "../lib/money";
import { cardDetailPath } from "../lib/cardSlug";
import { SUPPORT_EMAIL } from "./StaticPages";
import { trackingUrlFor, carrierLabel } from "../lib/tracking";
import { isStripeConfigured } from "../lib/stripeClient";
import { MyDecksSection } from "./MyDecksPage";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PROGRESS_STEPS,
  isHaltedStatus,
  progressIndex,
  orderNumber,
  type OrderStatus,
  type PaymentStatus,
} from "../lib/orderStatus";

// Account area. Every read is scoped by the signed-in user's RLS policies
// (profiles/orders/order_items/addresses/store_credit_transactions all enforce
// ownership in the database), so one customer can never see another's data.

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { path, navigate } = useRouter();
  useEffect(() => {
    // Preserve the originally-requested page (e.g. /account/wishlist) so
    // signing in lands back where the visitor meant to go, instead of always
    // dropping them on the dashboard.
    if (!loading && !user) {
      navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
    }
  }, [loading, user, path, navigate]);
  if (loading) return <div className="gg-page">Loading…</div>;
  if (!user) return null;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ *
 * Shell: light-theme account nav + content pane
 * ------------------------------------------------------------------ */

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: "/account", label: "Dashboard" },
  { to: "/account/profile", label: "Profile" },
  { to: "/account/orders", label: "Orders" },
  { to: "/account/decks", label: "My Decks" },
  { to: "/account/wishlist", label: "Wishlist" },
  { to: "/account/sell-submissions", label: "Sell submissions" },
  { to: "/account/addresses", label: "Addresses" },
  { to: "/account/credit", label: "Store credit" },
  { to: "/account/notifications", label: "Notifications" },
  { to: "/account/security", label: "Password & security" },
];

function AccountNav({ path }: { path: string }) {
  const { navigate } = useRouter();
  const { signOut } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = [
    { to: "/account", label: "Home", icon: "⌂" },
    { to: "/account/orders", label: "Orders", icon: "▤" },
    { to: "/account/decks", label: "Decks", icon: "◇" },
  ];
  const primaryPaths = new Set(primary.map((item) => item.to));
  const secondary = NAV_ITEMS.filter((item) => !primaryPaths.has(item.to));
  const moreActive = secondary.some((item) => item.to === path);

  function go(to: string) {
    setMoreOpen(false);
    navigate(to);
  }

  return (
    <>
      <div className="gg-account-mobile-tabs" aria-label="Account navigation">
        {primary.map((item) => (
          <button
            key={item.to}
            type="button"
            className={path === item.to ? "gg-active" : undefined}
            aria-current={path === item.to ? "page" : undefined}
            onClick={() => go(item.to)}
          >
            <span className="gg-account-mobile-tabs__icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={moreOpen || moreActive ? "gg-active" : undefined}
          aria-expanded={moreOpen}
          aria-controls="gg-account-more-sheet"
          onClick={() => setMoreOpen(true)}
        >
          <span className="gg-account-mobile-tabs__icon" aria-hidden="true">•••</span>
          <span>More</span>
        </button>
      </div>

      {moreOpen && (
        <div className="gg-account-sheet-layer" role="presentation" onMouseDown={() => setMoreOpen(false)}>
          <section
            id="gg-account-more-sheet"
            className="gg-account-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More account options"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="gg-account-sheet__handle" aria-hidden="true" />
            <div className="gg-account-sheet__head">
              <div>
                <strong>Account</strong>
                <span>More options</span>
              </div>
              <button type="button" className="gg-account-sheet__close" onClick={() => setMoreOpen(false)} aria-label="Close account menu">×</button>
            </div>

            <div className="gg-account-sheet__links">
              {secondary.map((item) => (
                <button
                  key={item.to}
                  type="button"
                  className={path === item.to ? "gg-active" : undefined}
                  onClick={() => go(item.to)}
                >
                  <span>{item.label}</span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="gg-account-sheet__signout"
              onClick={async () => {
                await signOut();
                setMoreOpen(false);
                navigate("/");
              }}
            >
              Sign out
            </button>
          </section>
        </div>
      )}

      <nav className="gg-account-nav" aria-label="Account">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={path === item.to ? "gg-active" : undefined}
            aria-current={path === item.to ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
        <SignOutRow navigate={navigate} />
      </nav>
    </>
  );
}

function SignOutRow({ navigate }: { navigate: (to: string) => void }) {
  const { signOut } = useAuth();
  return (
    <div className="gg-account-nav__signout">
      <button
        onClick={async () => {
          await signOut();
          navigate("/");
        }}
      >
        Sign out
      </button>
    </div>
  );
}

function AccountShell({
  path,
  title,
  subtitle,
  children,
}: {
  path: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="gg-page">
      <div className="gg-account-header">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="gg-account">
        <AccountNav path={path} />
        <div className="gg-account-main">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Shared bits: status badges, order progress, Track My Order
 * ------------------------------------------------------------------ */

export function StatusBadge({
  status,
  kind,
}: {
  status: string;
  kind: "order" | "payment";
}) {
  const label =
    kind === "order"
      ? (ORDER_STATUS_LABELS[status as OrderStatus] ?? status)
      : (PAYMENT_STATUS_LABELS[status as PaymentStatus] ?? status);
  return (
    <span className={`gg-badge-status gg-badge-status-${status}`}>{label}</span>
  );
}

export function OrderProgress({
  status,
  timestamps,
}: {
  status: OrderStatus;
  timestamps: Partial<Record<OrderStatus, string | null>>;
}) {
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    // .gg-progress scrolls horizontally on narrow screens (6 steps don't fit
    // a phone width). Without this, a visitor whose order is further along
    // (e.g. "Shipped") lands on a view scrolled to the far left, where the
    // current step's dot — the one thing this panel exists to show — is
    // off-screen with no visible hint that there's more to scroll to.
    currentRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [status]);

  if (isHaltedStatus(status)) {
    return (
      <div
        className={`gg-order-halt gg-order-halt--${status === "cancelled" ? "cancelled" : "refunded"}`}
        role="status"
      >
        {status === "cancelled"
          ? "This order was cancelled."
          : "This order was refunded."}
      </div>
    );
  }
  const current = progressIndex(status);
  return (
    <ol className="gg-progress" aria-label="Order progress">
      {PROGRESS_STEPS.map((step, i) => {
        const at = timestamps[step.status];
        const done = i < current || (i === current && !!at);
        const isCurrent = i === current;
        return (
          <li
            key={step.status}
            ref={isCurrent ? currentRef : undefined}
            className={`gg-progress-step ${done ? "gg-done" : ""} ${isCurrent ? "gg-current" : ""}`}
          >
            <span className="gg-progress-dot" aria-hidden="true" />
            {step.label}
            {at && <small>{new Date(at).toLocaleDateString()}</small>}
          </li>
        );
      })}
    </ol>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="gg-btn gg-btn-ghost gg-btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — the number is still selectable text */
        }
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

/** Shared "Track My Order" panel used on the dashboard and order detail. */
export function TrackingPanel({
  shippingMethod,
  status,
  trackingCarrier,
  trackingNumber,
}: {
  shippingMethod: string;
  status: OrderStatus;
  trackingCarrier: string | null;
  trackingNumber: string | null;
}) {
  const shipped = status === "shipped" || status === "delivered";

  if (shippingMethod === "pwe") {
    return (
      <div className="gg-track gg-track--pwe">
        <strong>Plain White Envelope — Untracked</strong>
        <p className="gg-card-meta" style={{ marginTop: "0.4rem" }}>
          {shipped
            ? "This order has shipped via Plain White Envelope. This shipping method does not include tracking."
            : "This order will ship in a plain white envelope, which does not include tracking."}
        </p>
      </div>
    );
  }

  // Tracked shipping — shipping_method is the ONLY signal used here, never
  // shipping_cents (tracked shipping can be free on qualifying orders).
  if (!trackingNumber) {
    return (
      <div className="gg-track">
        <p style={{ margin: 0 }}>
          Tracking information will appear here once your order ships.
        </p>
      </div>
    );
  }

  const url = trackingUrlFor(trackingCarrier, trackingNumber);
  return (
    <div className="gg-track">
      <div className="gg-track-row">
        <span className="gg-badge">{carrierLabel(trackingCarrier)}</span>
        <span className="gg-track-num">{trackingNumber}</span>
        <CopyButton value={trackingNumber} />
      </div>
      {url ? (
        <a
          className="gg-btn"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Track package →
        </a>
      ) : (
        <p className="gg-card-meta" style={{ margin: 0 }}>
          Use the tracking number above on your carrier&rsquo;s website.
        </p>
      )}
    </div>
  );
}

export function ContactAboutOrderLink({ orderNum }: { orderNum: string }) {
  const subject = encodeURIComponent(`Question about order ${orderNum}`);
  const body = encodeURIComponent(
    `Hi Geega Games,\n\nI have a question about my order ${orderNum}.\n\n`,
  );
  return (
    <a
      className="gg-btn gg-btn-ghost gg-btn-sm"
      href={`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`}
    >
      Contact support about this order
    </a>
  );
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

type DashOrder = {
  id: string;
  created_at: string;
  status: OrderStatus;
  total_cents: number;
  shipping_method: string;
  tracking_carrier: string | null;
  tracking_number: string | null;
};

type DashAddress = {
  id: string;
  label: string | null;
  recipient: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  is_default: boolean;
};

function DashboardSection() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [order, setOrder] = useState<DashOrder | null>(null);
  const [address, setAddress] = useState<DashAddress | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const [profileRes, orderRes, addressRes, creditRes] = await Promise.all([
        supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle(),
        supabase
          .from("orders")
          .select(
            "id, created_at, status, total_cents, shipping_method, tracking_carrier, tracking_number",
          )
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("addresses")
          .select("id, label, recipient, line1, line2, city, state, postal_code, is_default")
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase.rpc("my_store_credit_balance"),
      ]);
      if (!active) return;
      setFirstName(profileRes.data?.first_name ?? "");
      setOrder((orderRes.data as DashOrder | null) ?? null);
      setAddress((addressRes.data as DashAddress | null) ?? null);
      setBalance(typeof creditRes.data === "number" ? creditRes.data : 0);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const greetName = firstName || user?.email?.split("@")[0] || "there";

  return (
    <div className="gg-account-dashboard">
      <div className="gg-dashboard-welcome">
        <strong>Welcome back, {greetName}.</strong>
        {user?.email && <span className="gg-card-meta">{user.email}</span>}
      </div>

      {loading ? (
        <p>Loading your account…</p>
      ) : (
        <div className="gg-dash-grid">
          <div className="gg-dash-card gg-dash-card--wide">
            <h2>Current order</h2>
            {order ? (
              <>
                <div className="gg-dashboard-order">
                  <div className="gg-dashboard-order__info">
                    <strong>{orderNumber(order.id)}</strong>{" "}
                    <span className="gg-card-meta">
                      placed {new Date(order.created_at).toLocaleDateString()}
                    </span>
                    <div style={{ marginTop: "0.35rem" }}>
                      <StatusBadge status={order.status} kind="order" />
                    </div>
                  </div>
                  <div className="gg-dashboard-order__action">
                    <div className="gg-price">{formatCents(order.total_cents)}</div>
                    <Link to={`/account/orders/${order.id}`} className="gg-btn gg-btn-ghost gg-btn-sm">
                      View order
                    </Link>
                  </div>
                </div>
                {!isHaltedStatus(order.status) && (
                  <div style={{ marginTop: "1rem" }}>
                    <TrackingPanel
                      shippingMethod={order.shipping_method}
                      status={order.status}
                      trackingCarrier={order.tracking_carrier}
                      trackingNumber={order.tracking_number}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="gg-empty" style={{ padding: "1.5rem 0" }}>
                <p>You haven&rsquo;t placed an order yet.</p>
                <Link to="/shop" className="gg-btn">
                  Start shopping
                </Link>
              </div>
            )}
          </div>

          <div className="gg-dash-card">
            <h2>Default shipping address</h2>
            {address ? (
              <>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {address.label ? `${address.label} · ` : ""}
                  {address.recipient}
                </p>
                <p className="gg-card-meta" style={{ margin: "0.3rem 0 0" }}>
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}
                  <br />
                  {address.city}, {address.state} {address.postal_code}
                </p>
              </>
            ) : (
              <p className="gg-card-meta">No saved address yet.</p>
            )}
            <div className="gg-dash-actions">
              <Link to="/account/addresses" className="gg-btn gg-btn-ghost gg-btn-sm">
                {address ? "Manage addresses" : "Add an address"}
              </Link>
            </div>
          </div>

          <div className="gg-dash-card">
            <h2>Store credit</h2>
            <div className="gg-dash-stat">
              {balance == null ? "…" : formatCents(balance)}
            </div>
            <div className="gg-dash-actions">
              <Link to="/account/credit" className="gg-btn gg-btn-ghost gg-btn-sm">
                Details
              </Link>
              <Link to="/account/orders" className="gg-btn gg-btn-ghost gg-btn-sm">
                Order history
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Profile
 * ------------------------------------------------------------------ */

function ProfileSection() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("first_name, last_name, phone")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFirstName(data.first_name ?? "");
          setLastName(data.last_name ?? "");
          setPhone(data.phone ?? "");
        }
        setLoading(false);
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setStatus(null);
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    setStatus(
      error
        ? { text: error.message, error: true }
        : { text: "Your profile has been updated." },
    );
  };

  if (loading) return <p>Loading profile…</p>;
  return (
    <div className="gg-dash-card" style={{ maxWidth: 480 }}>
      <h2>Profile</h2>
      {status && (
        <div
          className={`gg-alert ${status.error ? "gg-alert-error" : "gg-alert-ok"}`}
          role="status"
        >
          {status.text}
        </div>
      )}
      <div className="gg-form" style={{ margin: "0.75rem 0 0", maxWidth: "none" }}>
        <div className="gg-field">
          <label htmlFor="p-email">Email</label>
          <input id="p-email" value={user?.email ?? ""} disabled autoComplete="email" />
          <span className="gg-card-meta">
            Your email is your sign-in ID and can&rsquo;t be changed here.
          </span>
        </div>
        <div className="gg-field">
          <label htmlFor="p-fn">First name</label>
          <input
            id="p-fn"
            value={firstName}
            autoComplete="given-name"
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="p-ln">Last name</label>
          <input
            id="p-ln"
            value={lastName}
            autoComplete="family-name"
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="p-ph">Phone</label>
          <input
            id="p-ph"
            type="tel"
            value={phone}
            autoComplete="tel"
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <button className="gg-btn" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>
      <p style={{ marginTop: "1.25rem" }}>
        <Link to="/account/security" className="gg-btn gg-btn-ghost gg-btn-sm">
          Password &amp; security →
        </Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Password & security
 * ------------------------------------------------------------------ */

function SecuritySection() {
  const { user, updatePassword, requestPasswordReset } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const submit = async () => {
    setStatus(null);
    if (password.length < 6) {
      setStatus({ text: "Please choose a password with at least 6 characters.", error: true });
      return;
    }
    if (password !== confirm) {
      setStatus({ text: "Passwords don't match.", error: true });
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setPassword("");
      setConfirm("");
      setStatus({ text: "Your password has been updated." });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Could not update your password.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    if (!user?.email) return;
    setStatus(null);
    try {
      await requestPasswordReset(user.email);
      setResetSent(true);
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Could not send the reset email.", error: true });
    }
  };

  return (
    <div className="gg-dash-card" style={{ maxWidth: 480 }}>
      <h2>Password &amp; security</h2>
      {status && (
        <div className={`gg-alert ${status.error ? "gg-alert-error" : "gg-alert-ok"}`} role="status">
          {status.text}
        </div>
      )}
      <div className="gg-form" style={{ margin: "0.75rem 0 0", maxWidth: "none" }}>
        <div className="gg-field">
          <label htmlFor="s-pw">New password</label>
          <input
            id="s-pw"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="gg-field">
          <label htmlFor="s-pw2">Confirm new password</label>
          <input
            id="s-pw2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button className="gg-btn" onClick={submit} disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </div>
      <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--gg-line)" }}>
        <p className="gg-card-meta" style={{ marginBottom: "0.5rem" }}>
          Forgot your current password? We&rsquo;ll email you a reset link.
        </p>
        {resetSent ? (
          <div className="gg-alert gg-alert-ok" role="status">
            Check your inbox for a password reset link.
          </div>
        ) : (
          <button className="gg-btn gg-btn-ghost gg-btn-sm" onClick={sendReset}>
            Send password reset email
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Orders list
 * ------------------------------------------------------------------ */

type OrderRow = {
  id: string;
  created_at: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total_cents: number;
  shipping_method: string;
  tracking_number: string | null;
};

function shipmentStatusText(o: OrderRow): string {
  if (isHaltedStatus(o.status)) return ORDER_STATUS_LABELS[o.status];
  if (o.shipping_method === "pwe") {
    return o.status === "shipped" || o.status === "delivered"
      ? "Shipped (PWE, untracked)"
      : "Not yet shipped";
  }
  if (o.tracking_number) return "Tracking available";
  return o.status === "shipped" || o.status === "delivered" ? "Shipped" : "Not yet shipped";
}

function OrdersSection() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("orders")
      .select(
        "id, created_at, status, payment_status, total_cents, shipping_method, tracking_number",
      )
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setOrders((data ?? []) as OrderRow[]);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading orders…</p>;
  if (error)
    return (
      <div className="gg-alert gg-alert-error" role="alert">
        {error}
      </div>
    );
  if (orders.length === 0)
    return (
      <div className="gg-empty">
        <p>You have no orders yet.</p>
        <Link to="/shop" className="gg-btn gg-btn-ghost">
          Start shopping
        </Link>
      </div>
    );

  return (
    <div>
      {orders.map((o) => (
        <Link key={o.id} to={`/account/orders/${o.id}`} className="gg-orderrow">
          <div>
            <strong>{orderNumber(o.id)}</strong>{" "}
            <span className="gg-card-meta">
              {new Date(o.created_at).toLocaleDateString()}
            </span>
            <div className="gg-orderrow-meta">
              <StatusBadge status={o.status} kind="order" />
              <StatusBadge status={o.payment_status} kind="payment" />
              <span className="gg-card-meta">{shipmentStatusText(o)}</span>
            </div>
          </div>
          <div className="gg-orderrow-right">
            <span className="gg-price">{formatCents(o.total_cents)}</span>
            <span className="gg-btn gg-btn-ghost gg-btn-sm" aria-hidden="true">
              View order
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Wishlist -- cards saved via the heart icon on ProductCard/CardDetailPage.
 * Reads through my_wishlist(), which live-joins current inventory (and falls
 * back to the Scryfall art cache for an out-of-stock save), so this always
 * shows real availability rather than a stale add-time snapshot.
 * ------------------------------------------------------------------ */

type WishlistRow = {
  id: string;
  oracle_id: string;
  card_name: string;
  created_at: string;
  image_url: string | null;
  in_stock: boolean;
  min_price_cents: number | null;
  inventory_item_id: string | null;
};

function WishlistSection() {
  const { addItem } = useCart();
  const [rows, setRows] = useState<WishlistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .rpc("my_wishlist")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows((data ?? []) as WishlistRow[]);
      });
  }, []);

  async function remove(row: WishlistRow) {
    setRemovingId(row.id);
    const { error } = await supabase
      .from("customer_wishlist_items")
      .delete()
      .eq("id", row.id);
    if (!error) {
      setRows((cur) => (cur ?? []).filter((r) => r.id !== row.id));
    }
    setRemovingId(null);
  }

  if (rows === null && !error) return <p>Loading your wishlist…</p>;
  if (error)
    return (
      <div className="gg-alert gg-alert-error" role="alert">
        {error}
      </div>
    );
  if (!rows || rows.length === 0)
    return (
      <div className="gg-empty">
        <p>You haven&rsquo;t saved any cards yet.</p>
        <Link to="/shop" className="gg-btn gg-btn-ghost">
          Browse the shop
        </Link>
      </div>
    );

  return (
    <div className="gg-wishlist-grid">
      {rows.map((row) => (
        <div className="gg-wishlist-card" key={row.id}>
          <Link to={cardDetailPath(row.card_name)} className="gg-wishlist-card__imgwrap">
            {row.image_url ? (
              <img src={row.image_url} alt={row.card_name} loading="lazy" />
            ) : (
              <div className="gg-wishlist-card__noimage">No image</div>
            )}
          </Link>
          <div className="gg-wishlist-card__body">
            <Link to={cardDetailPath(row.card_name)} className="gg-card-name">
              {row.card_name}
            </Link>
            <div className="gg-card-meta">
              {row.in_stock ? formatCents(row.min_price_cents ?? 0) : "Currently out of stock"}
            </div>
            <div className="gg-wishlist-card__actions">
              {row.in_stock && row.inventory_item_id ? (
                <button
                  className="gg-btn gg-btn-sm"
                  disabled={addingId === row.id}
                  onClick={async () => {
                    setAddingId(row.id);
                    try {
                      await addItem(row.inventory_item_id!, 1);
                      setAddedId(row.id);
                      window.setTimeout(
                        () => setAddedId((cur) => (cur === row.id ? null : cur)),
                        1500,
                      );
                    } finally {
                      setAddingId(null);
                    }
                  }}
                >
                  {addedId === row.id ? "Added ✓" : addingId === row.id ? "Adding…" : "Add to cart"}
                </button>
              ) : (
                <Link to={cardDetailPath(row.card_name)} className="gg-btn gg-btn-sm gg-btn-ghost">
                  View card
                </Link>
              )}
              <button
                type="button"
                className="gg-wishlist-card__remove"
                disabled={removingId === row.id}
                onClick={() => remove(row)}
                aria-label={`Remove ${row.card_name} from wishlist`}
                title="Remove from wishlist"
              >
                {removingId === row.id ? "…" : "✕"}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sell submissions — read-only status list. Deliberately shows ONLY
 * reference number, date, and status: internal notes, staff valuation
 * estimates, and offer/purchase amounts are staff-only and are never
 * queried here (RLS also wouldn't allow it, but the column list itself is
 * kept minimal on principle).
 * ------------------------------------------------------------------ */

type SellSubmissionRow = {
  id: string;
  reference_number: string;
  created_at: string;
  status: string;
};

const SELL_SUBMISSION_STATUS_LABELS: Record<string, string> = {
  new: "New — awaiting review",
  reviewing: "Being reviewed",
  needs_more_photos: "We need a few more photos from you",
  needs_in_person_review: "We'd like to take a closer look in person",
  contacted: "We've been in touch",
  offer_made: "Offer made",
  accepted: "Offer accepted",
  declined: "Declined",
  completed: "Completed",
  closed: "Closed",
};

function SellSubmissionsSection() {
  const [rows, setRows] = useState<SellSubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A narrow, staff-independent RPC (same pattern as my_store_credit_balance)
    // rather than a direct table query — sell_submissions rows also carry
    // staff-only columns (internal notes, offer/purchase amounts) that must
    // never reach the seller, so reads go through RLS-safe function that
    // only ever returns the four columns below, never the whole row.
    supabase
      .rpc("my_sell_submissions")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows((data ?? []) as SellSubmissionRow[]);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading your submissions…</p>;
  if (error)
    return (
      <div className="gg-alert gg-alert-error" role="alert">
        {error}
      </div>
    );
  if (rows.length === 0)
    return (
      <div className="gg-empty">
        <p>You haven&rsquo;t submitted a collection yet.</p>
        <Link to="/sell" className="gg-btn gg-btn-ghost">
          Sell your cards
        </Link>
      </div>
    );

  return (
    <div>
      {rows.map((r) => (
        <div className="gg-orderrow" key={r.id} style={{ cursor: "default" }}>
          <div>
            <strong>{r.reference_number}</strong>{" "}
            <span className="gg-card-meta">{new Date(r.created_at).toLocaleDateString()}</span>
          </div>
          <div className="gg-orderrow-right">
            <span className="gg-card-meta">{SELL_SUBMISSION_STATUS_LABELS[r.status] ?? r.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Order detail
 * ------------------------------------------------------------------ */

type OrderDetail = {
  id: string;
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
};
type OrderItem = {
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

function OrderDetailSection({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: o, error: oErr } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();
      if (oErr) {
        setError(oErr.message);
        setLoading(false);
        return;
      }
      if (!o) {
        setError("Order not found.");
        setLoading(false);
        return;
      }
      setOrder(o as OrderDetail);
      const { data: it } = await supabase
        .from("order_items")
        .select(
          "id, card_name, set_code, set_name, collector_number, condition, finish, variant_type, quantity, unit_price_cents, line_total_cents, image_url",
        )
        .eq("order_id", orderId);
      setItems((it ?? []) as OrderItem[]);
      setLoading(false);
    })();
  }, [orderId]);

  if (loading) return <p>Loading order…</p>;
  if (error)
    return (
      <div className="gg-alert gg-alert-error" role="alert">
        {error} <Link to="/account/orders">Back to orders</Link>
      </div>
    );
  if (!order) return null;

  const num = orderNumber(order.id);

  return (
    <div>
      <Link to="/account/orders">← Back to orders</Link>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "0.75rem",
          margin: "0.5rem 0 0.25rem",
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 0.25rem" }}>Order {num}</h2>
          <p className="gg-card-meta" style={{ margin: 0 }}>
            Placed {new Date(order.created_at).toLocaleString()}
          </p>
        </div>
        <ContactAboutOrderLink orderNum={num} />
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
      {items.map((it) => (
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
            Amount due: {formatCents(order.amount_due_cents)} — we&rsquo;re confirming
            your payment now. This page will update once it&rsquo;s complete.
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

export function Row({
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
        padding: "0.2rem 0",
        fontWeight: strong ? 700 : 400,
      }}
    >
      <span>{label}</span>
      <span>{formatCents(value)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Addresses
 * ------------------------------------------------------------------ */

type Address = {
  id: string;
  label: string | null;
  recipient: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string | null;
  is_default: boolean;
};

const EMPTY_ADDRESS: Partial<Address> = { country: "US" };

function AddressesSection() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Address> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("addresses")
      .select("*")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    else setAddresses((data ?? []) as Address[]);
    setLoading(false);
    return (data ?? []) as Address[];
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!editing) return;
    setFormError(null);
    if (!editing.line1?.trim() || !editing.city?.trim() || !editing.state?.trim() || !editing.postal_code?.trim()) {
      setFormError("Please fill in address line 1, city, state, and postal code.");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;
    setSaving(true);
    const payload = {
      user_id: uid,
      label: editing.label?.trim() || null,
      recipient: editing.recipient?.trim() || null,
      line1: editing.line1.trim(),
      line2: editing.line2?.trim() || null,
      city: editing.city.trim(),
      state: editing.state.trim(),
      postal_code: editing.postal_code.trim(),
      country: editing.country?.trim() || "US",
      phone: editing.phone?.trim() || null,
      is_default: editing.is_default ?? false,
    };
    const res = editing.id
      ? await supabase.from("addresses").update(payload).eq("id", editing.id)
      : await supabase.from("addresses").insert(payload);
    setSaving(false);
    if (res.error) setFormError(res.error.message);
    else {
      setEditing(null);
      await load();
    }
  };

  const remove = async (id: string) => {
    await supabase.from("addresses").delete().eq("id", id);
    const rows = await load();
    // Keep a default set whenever any address remains — the DB trigger only
    // auto-assigns a default on a brand-new address, not after a delete.
    if (rows.length > 0 && !rows.some((a) => a.is_default)) {
      await supabase.from("addresses").update({ is_default: true }).eq("id", rows[0].id);
      await load();
    }
  };

  const makeDefault = async (id: string) => {
    await supabase.from("addresses").update({ is_default: true }).eq("id", id);
    await load();
  };

  if (loading) return <p>Loading addresses…</p>;

  return (
    <div style={{ maxWidth: 640 }}>
      {error && (
        <div className="gg-alert gg-alert-error" role="alert">
          {error}
        </div>
      )}
      {addresses.length === 0 && !editing && (
        <div className="gg-empty" style={{ padding: "1.5rem 0" }}>
          <p>You haven&rsquo;t saved a shipping address yet.</p>
        </div>
      )}
      {addresses.map((a) => (
        <div className={`gg-address-card ${a.is_default ? "gg-address-card--default" : ""}`} key={a.id}>
          <div className="gg-address-card__head">
            <div>
              <strong>{a.label || "Address"}</strong>
              {a.is_default && <span className="gg-badge" style={{ marginLeft: "0.5rem" }}>Default</span>}
              <div className="gg-card-meta" style={{ marginTop: "0.3rem" }}>
                {a.recipient}
                <br />
                {a.line1}
                {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.postal_code}, {a.country}
                {a.phone ? <><br />{a.phone}</> : null}
              </div>
            </div>
          </div>
          <div className="gg-address-card__actions">
            {!a.is_default && (
              <button className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => makeDefault(a.id)}>
                Set as default
              </button>
            )}
            <button className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => setEditing(a)}>
              Edit
            </button>
            <button className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => remove(a.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}

      {editing ? (
        <div className="gg-form" style={{ margin: "1rem 0 0", maxWidth: "none" }}>
          <h3 style={{ marginTop: 0 }}>{editing.id ? "Edit address" : "New address"}</h3>
          {formError && (
            <div className="gg-alert gg-alert-error" role="alert">
              {formError}
            </div>
          )}
          <div className="gg-field">
            <label htmlFor="a-label">Label (e.g. Home, Work)</label>
            <input
              id="a-label"
              value={editing.label ?? ""}
              onChange={(e) => setEditing((s) => ({ ...s, label: e.target.value }))}
            />
          </div>
          <div className="gg-form-grid">
            <div className="gg-field gg-field-span2">
              <label htmlFor="a-recipient">Recipient name</label>
              <input
                id="a-recipient"
                autoComplete="name"
                value={editing.recipient ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, recipient: e.target.value }))}
              />
            </div>
            <div className="gg-field gg-field-span2">
              <label htmlFor="a-line1">Address line 1</label>
              <input
                id="a-line1"
                autoComplete="address-line1"
                value={editing.line1 ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, line1: e.target.value }))}
              />
            </div>
            <div className="gg-field gg-field-span2">
              <label htmlFor="a-line2">Address line 2 (optional)</label>
              <input
                id="a-line2"
                autoComplete="address-line2"
                value={editing.line2 ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, line2: e.target.value }))}
              />
            </div>
            <div className="gg-field">
              <label htmlFor="a-city">City</label>
              <input
                id="a-city"
                autoComplete="address-level2"
                value={editing.city ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, city: e.target.value }))}
              />
            </div>
            <div className="gg-field">
              <label htmlFor="a-state">State</label>
              <input
                id="a-state"
                autoComplete="address-level1"
                value={editing.state ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, state: e.target.value }))}
              />
            </div>
            <div className="gg-field">
              <label htmlFor="a-postal">Postal code</label>
              <input
                id="a-postal"
                autoComplete="postal-code"
                inputMode="numeric"
                value={editing.postal_code ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, postal_code: e.target.value }))}
              />
            </div>
            <div className="gg-field">
              <label htmlFor="a-country">Country</label>
              <input
                id="a-country"
                autoComplete="country"
                value={editing.country ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, country: e.target.value }))}
              />
            </div>
            <div className="gg-field gg-field-span2">
              <label htmlFor="a-phone">Phone</label>
              <input
                id="a-phone"
                type="tel"
                autoComplete="tel"
                value={editing.phone ?? ""}
                onChange={(e) => setEditing((s) => ({ ...s, phone: e.target.value }))}
              />
            </div>
          </div>
          <label className="gg-check">
            <input
              type="checkbox"
              checked={editing.is_default ?? false}
              onChange={(e) => setEditing((s) => ({ ...s, is_default: e.target.checked }))}
            />
            Make this my default shipping address
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="gg-btn" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save address"}
            </button>
            <button className="gg-btn gg-btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="gg-btn gg-btn-ghost"
          style={{ marginTop: "1rem" }}
          onClick={() => setEditing({ ...EMPTY_ADDRESS })}
        >
          + Add address
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Store credit
 * ------------------------------------------------------------------ */

function StoreCreditSection() {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    supabase.rpc("my_store_credit_balance").then(({ data }) => {
      setBalance(typeof data === "number" ? data : 0);
    });
  }, []);
  return (
    <div className="gg-dash-card" style={{ maxWidth: 420 }}>
      <h2>Store credit</h2>
      <p className="gg-dash-stat">{balance == null ? "…" : formatCents(balance)}</p>
      <p className="gg-card-meta">
        Store credit is applied at checkout. Balances are managed by Geega Games.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Notifications — order/shipping + sell submission email preferences.
 * Both default OFF at signup (see handle_new_user() / the signup checkbox);
 * this page is where a customer turns them on or off any time after. Only
 * the `enabled` flag is exposed — byEmail/byText stay fixed (email-only;
 * there's no SMS provider wired up) so we always write back the same shape.
 * ------------------------------------------------------------------ */

type NotificationPrefs = { enabled: boolean; byEmail: boolean; byText: boolean };

function toPrefs(value: unknown): NotificationPrefs {
  const v = (value ?? {}) as Partial<NotificationPrefs>;
  return { enabled: v.enabled === true, byEmail: true, byText: false };
}

function NotificationToggle({
  label,
  description,
  checked,
  saving,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  saving: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="gg-check" style={{ alignItems: "flex-start", marginBottom: "1rem" }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={saving}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong style={{ display: "block" }}>{label}</strong>
        <span className="gg-card-meta">{description}</span>
      </span>
    </label>
  );
}

function NotificationsSection() {
  const { user } = useAuth();
  const accountDb = supabase as any;
  const [shipping, setShipping] = useState<NotificationPrefs>({ enabled: false, byEmail: true, byText: false });
  const [sellSubmission, setSellSubmission] = useState<NotificationPrefs>({
    enabled: false,
    byEmail: true,
    byText: false,
  });
  const [deckAlerts, setDeckAlerts] = useState<Array<{
    id: string;
    card_name: string;
    inventory_item_id: string | null;
    deck_names: string[];
    created_at: string;
    read_at: string | null;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"shipping" | "sell" | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase
        .from("profiles")
        .select("shipping_notifications, sell_submission_notifications")
        .eq("id", user.id)
        .maybeSingle(),
      accountDb.rpc("deck_notification_summary"),
    ]).then(([profileRes, alertsRes]) => {
      if (profileRes.data) {
        setShipping(toPrefs(profileRes.data.shipping_notifications));
        setSellSubmission(toPrefs(profileRes.data.sell_submission_notifications));
      }
      setDeckAlerts((alertsRes.data ?? []) as typeof deckAlerts);
      setLoading(false);
    });
  }, [user]);

  async function updateShipping(enabled: boolean) {
    if (!user) return;
    setStatus(null);
    setSaving("shipping");
    const next = { ...shipping, enabled };
    const { error } = await supabase
      .from("profiles")
      .update({ shipping_notifications: next })
      .eq("id", user.id);
    setSaving(null);
    if (error) setStatus({ text: error.message, error: true });
    else setShipping(next);
  }

  async function updateSellSubmission(enabled: boolean) {
    if (!user) return;
    setStatus(null);
    setSaving("sell");
    const next = { ...sellSubmission, enabled };
    const { error } = await supabase
      .from("profiles")
      .update({ sell_submission_notifications: next })
      .eq("id", user.id);
    setSaving(null);
    if (error) setStatus({ text: error.message, error: true });
    else setSellSubmission(next);
  }

  async function markDeckAlertRead(id: string) {
    await accountDb
      .from("deck_stock_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user?.id);
    setDeckAlerts((rows) => rows.filter((r) => r.id !== id));
  }

  if (loading) return <p>Loading your notification preferences…</p>;

  return (
    <div className="gg-dash-card" style={{ maxWidth: 480 }}>
      <h2>Notifications</h2>
      {status && (
        <div className={`gg-alert ${status.error ? "gg-alert-error" : "gg-alert-ok"}`} role="status">
          {status.text}
        </div>
      )}
      <div style={{ margin: "0.75rem 0 0" }}>
        <NotificationToggle
          label="Order & shipping updates"
          description="Email me when an order ships, is delivered, cancelled, or refunded."
          checked={shipping.enabled}
          saving={saving === "shipping"}
          onChange={updateShipping}
        />
        <NotificationToggle
          label="Sell submission updates"
          description="Email me about status changes on a Sell Your Cards / Sell Your Collection submission."
          checked={sellSubmission.enabled}
          saving={saving === "sell"}
          onChange={updateSellSubmission}
        />
      </div>
      <p className="gg-card-meta" style={{ marginTop: "0.5rem" }}>
        These are off by default for new accounts. Turning them off does not affect your
        order confirmation or sell submission confirmation receipts — those always send.
      </p>

      <div className="gg-deck-alerts">
        <div className="gg-deck-alerts__head">
          <h3>Deck restock alerts</h3>
          <Link to="/account/decks" className="gg-btn gg-btn-ghost gg-btn-sm">
            Manage decks
          </Link>
        </div>
        {deckAlerts.length === 0 ? (
          <p className="gg-card-meta">No unread deck restock alerts.</p>
        ) : (
          deckAlerts.map((alert) => (
            <div className="gg-deck-alert" key={alert.id}>
              <div>
                <strong>{alert.card_name} is available</strong>
                <p className="gg-card-meta">
                  {alert.deck_names.length
                    ? `Watching for ${alert.deck_names.join(", ")}`
                    : "A card from one of your saved decks is back in stock."}
                </p>
              </div>
              <div className="gg-deck-alert__actions">
                <Link
                  to={`/shop?q=${encodeURIComponent(alert.card_name)}`}
                  className="gg-btn gg-btn-sm"
                >
                  View card
                </Link>
                <button
                  className="gg-btn gg-btn-ghost gg-btn-sm"
                  onClick={() => void markDeckAlertRead(alert.id)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Top-level router
 * ------------------------------------------------------------------ */

export function AccountPage() {
  const { path } = useRouter();
  const orderMatch = matchRoute("/account/orders/:id", path);
  const deckMatch = matchRoute("/account/decks/:id", path);

  let title = "Dashboard";
  let subtitle: string | undefined;
  let body: React.ReactNode = <DashboardSection />;

  if (path === "/account/profile") {
    title = "Profile";
    body = <ProfileSection />;
  } else if (path === "/account/security") {
    title = "Password & security";
    body = <SecuritySection />;
  } else if (path === "/account/orders") {
    title = "Orders";
    subtitle = "Your order history and shipment status.";
    body = <OrdersSection />;
  } else if (path === "/account/decks") {
    title = "My Decks";
    subtitle = "Build decks, watch missing cards, and get suggestions.";
    body = <MyDecksSection />;
  } else if (path === "/account/wishlist") {
    title = "Wishlist";
    subtitle = "Cards you've saved for later.";
    body = <WishlistSection />;
  } else if (deckMatch) {
    title = "Deck details";
    body = <MyDecksSection deckId={deckMatch.id} />;
  } else if (path === "/account/sell-submissions") {
    title = "Sell submissions";
    subtitle = "Collections and cards you've submitted to sell.";
    body = <SellSubmissionsSection />;
  } else if (path === "/account/notifications") {
    title = "Notifications";
    subtitle = "Choose which email updates you'd like to receive.";
    body = <NotificationsSection />;
  } else if (orderMatch) {
    title = "Order details";
    body = <OrderDetailSection orderId={orderMatch.id} />;
  } else if (path === "/account/addresses") {
    title = "Shipping addresses";
    body = <AddressesSection />;
  } else if (path === "/account/credit") {
    title = "Store credit";
    body = <StoreCreditSection />;
  } else if (path === "/account") {
    subtitle = "A quick look at your orders, address, and store credit.";
  }

  const navPath = orderMatch
    ? "/account/orders"
    : deckMatch
      ? "/account/decks"
      : path;

  return (
    <RequireAuth>
      <AccountShell path={navPath} title={title} subtitle={subtitle}>
        {body}
      </AccountShell>
    </RequireAuth>
  );
}
