import { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { useAuth } from "../lib/AuthContext";
import { Link, useRouter, matchRoute } from "../lib/router";
import { formatCents } from "../lib/money";

// Account area. Every read is scoped by the signed-in user's RLS policies
// (profiles/orders/order_items/addresses/store_credit_transactions all enforce
// ownership in the database), so one customer can never see another's data.

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { navigate } = useRouter();
  useEffect(() => {
    if (!loading && !user) navigate("/login?next=/account", { replace: true });
  }, [loading, user, navigate]);
  if (loading) return <div className="gg-page">Loading…</div>;
  if (!user) return null;
  return <>{children}</>;
}

function AccountNav() {
  return (
    <nav className="gg-nav" aria-label="Account" style={{ padding: "0 0 1rem" }}>
      <Link to="/account">Profile</Link>
      <Link to="/account/orders">Orders</Link>
      <Link to="/account/addresses">Addresses</Link>
      <Link to="/account/credit">Store credit</Link>
    </nav>
  );
}

function ProfileSection() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    const { error } = await supabase
      .from("profiles")
      .update({ first_name: firstName, last_name: lastName, phone })
      .eq("id", user.id);
    setStatus(error ? error.message : "Saved.");
  };

  if (loading) return <p>Loading profile…</p>;
  return (
    <div className="gg-form" style={{ margin: 0 }}>
      <h2>Profile</h2>
      {status && (
        <div className="gg-alert gg-alert-ok" role="status">
          {status}
        </div>
      )}
      <div className="gg-field">
        <label>Email</label>
        <input value={user?.email ?? ""} disabled />
      </div>
      <div className="gg-field">
        <label htmlFor="p-fn">First name</label>
        <input id="p-fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </div>
      <div className="gg-field">
        <label htmlFor="p-ln">Last name</label>
        <input id="p-ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <div className="gg-field">
        <label htmlFor="p-ph">Phone</label>
        <input id="p-ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <button className="gg-btn" onClick={save}>
        Save profile
      </button>
    </div>
  );
}

type OrderRow = {
  id: string;
  created_at: string;
  status: string;
  payment_status: string;
  total_cents: number;
  tracking_number: string | null;
  tracking_carrier: string | null;
};

function OrdersSection() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("orders")
      .select(
        "id, created_at, status, payment_status, total_cents, tracking_number, tracking_carrier",
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
      <h2>Orders</h2>
      {orders.map((o) => (
        <Link
          key={o.id}
          to={`/account/orders/${o.id}`}
          className="gg-line"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="gg-line-info">
            <div className="gg-card-name">
              Order #{o.id.slice(0, 8).toUpperCase()}
            </div>
            <div className="gg-card-meta">
              {new Date(o.created_at).toLocaleDateString()} · {o.status} ·{" "}
              {o.payment_status}
            </div>
            {o.tracking_number && (
              <div className="gg-card-meta">
                Tracking: {o.tracking_carrier} {o.tracking_number}
              </div>
            )}
          </div>
          <div className="gg-price">{formatCents(o.total_cents)}</div>
        </Link>
      ))}
    </div>
  );
}

type OrderDetail = OrderRow & {
  subtotal_cents: number;
  shipping_cents: number;
  store_credit_used_cents: number;
  amount_due_cents: number;
  shipping_method: string;
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
  condition: string;
  finish: string;
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
          "id, card_name, set_code, condition, finish, quantity, unit_price_cents, line_total_cents, image_url",
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

  return (
    <div>
      <Link to="/account/orders">← Back to orders</Link>
      <h2>Order #{order.id.slice(0, 8).toUpperCase()}</h2>
      <p className="gg-card-meta">
        {new Date(order.created_at).toLocaleString()} · {order.status} · payment:{" "}
        {order.payment_status}
      </p>

      {items.map((it) => (
        <div className="gg-line" key={it.id}>
          {it.image_url && (
            <img className="gg-line-img" src={it.image_url} alt="" loading="lazy" />
          )}
          <div className="gg-line-info">
            <div className="gg-card-name">{it.card_name}</div>
            <div className="gg-card-meta">
              {it.set_code?.toUpperCase()} · {it.condition} · {it.finish} ×{" "}
              {it.quantity}
            </div>
          </div>
          <div className="gg-price">{formatCents(it.line_total_cents)}</div>
        </div>
      ))}

      <div style={{ marginTop: "1rem", maxWidth: 320, marginLeft: "auto" }}>
        <Row label="Subtotal" value={order.subtotal_cents} />
        <Row label="Shipping" value={order.shipping_cents} />
        {order.store_credit_used_cents > 0 && (
          <Row label="Store credit" value={-order.store_credit_used_cents} />
        )}
        <Row label="Total" value={order.total_cents} strong />
      </div>

      {order.ship_recipient && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Shipping to</h3>
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

function Row({
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

type Address = {
  id: string;
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

function AddressesSection() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Address> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("addresses")
      .select("*")
      .order("is_default", { ascending: false });
    if (error) setError(error.message);
    else setAddresses((data ?? []) as Address[]);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!editing) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;
    setError(null);
    const payload = {
      user_id: uid,
      recipient: editing.recipient ?? null,
      line1: editing.line1 ?? "",
      line2: editing.line2 ?? null,
      city: editing.city ?? "",
      state: editing.state ?? "",
      postal_code: editing.postal_code ?? "",
      country: editing.country ?? "US",
      phone: editing.phone ?? null,
      is_default: editing.is_default ?? false,
    };
    const res = editing.id
      ? await supabase.from("addresses").update(payload).eq("id", editing.id)
      : await supabase.from("addresses").insert(payload);
    if (res.error) setError(res.error.message);
    else {
      setEditing(null);
      await load();
    }
  };

  const remove = async (id: string) => {
    await supabase.from("addresses").delete().eq("id", id);
    await load();
  };

  if (loading) return <p>Loading addresses…</p>;

  return (
    <div>
      <h2>Addresses</h2>
      {error && (
        <div className="gg-alert gg-alert-error" role="alert">
          {error}
        </div>
      )}
      {addresses.map((a) => (
        <div className="gg-line" key={a.id}>
          <div className="gg-line-info">
            <div className="gg-card-name">
              {a.recipient} {a.is_default && <span className="gg-badge">Default</span>}
            </div>
            <div className="gg-card-meta">
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state}{" "}
              {a.postal_code}, {a.country}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
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
        <div className="gg-form" style={{ margin: "1rem 0 0" }}>
          <h3>{editing.id ? "Edit address" : "New address"}</h3>
          {(
            [
              ["recipient", "Recipient"],
              ["line1", "Address line 1"],
              ["line2", "Address line 2"],
              ["city", "City"],
              ["state", "State"],
              ["postal_code", "Postal code"],
              ["country", "Country"],
              ["phone", "Phone"],
            ] as const
          ).map(([field, label]) => (
            <div className="gg-field" key={field}>
              <label>{label}</label>
              <input
                value={(editing[field] as string) ?? ""}
                onChange={(e) =>
                  setEditing((s) => ({ ...s, [field]: e.target.value }))
                }
              />
            </div>
          ))}
          <label className="gg-check">
            <input
              type="checkbox"
              checked={editing.is_default ?? false}
              onChange={(e) =>
                setEditing((s) => ({ ...s, is_default: e.target.checked }))
              }
            />
            Default shipping address
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="gg-btn" onClick={save}>
              Save
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
          onClick={() => setEditing({ country: "US" })}
        >
          + Add address
        </button>
      )}
    </div>
  );
}

function StoreCreditSection() {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    supabase.rpc("my_store_credit_balance").then(({ data }) => {
      setBalance(typeof data === "number" ? data : 0);
    });
  }, []);
  return (
    <div>
      <h2>Store credit</h2>
      <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--gg-purple)" }}>
        {balance == null ? "…" : formatCents(balance)}
      </p>
      <p className="gg-card-meta">
        Store credit is applied at checkout. Balances are managed by Geega Games.
      </p>
    </div>
  );
}

export function AccountPage() {
  const { path } = useRouter();
  const orderMatch = matchRoute("/account/orders/:id", path);

  return (
    <RequireAuth>
      <div className="gg-page">
        <h1 style={{ color: "var(--gg-ink)" }}>Your account</h1>
        <AccountNav />
        {path === "/account" && <ProfileSection />}
        {path === "/account/orders" && <OrdersSection />}
        {orderMatch && <OrderDetailSection orderId={orderMatch.id} />}
        {path === "/account/addresses" && <AddressesSection />}
        {path === "/account/credit" && <StoreCreditSection />}
      </div>
    </RequireAuth>
  );
}
