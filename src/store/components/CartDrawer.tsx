import { useEffect, useRef } from "react";
import { useCart } from "../lib/CartContext";
import { useAuth } from "../lib/AuthContext";
import { Link, useRouter } from "../lib/router";
import { formatCents } from "../lib/money";
import { formatReopenDate, useStoreStatus } from "../lib/storeStatus";

// Accessible slide-over cart. Focus is trapped while open; Escape closes;
// the trigger is restored on close. Live cart data comes from CartContext.

export default function CartDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { lines, subtotalCents, itemCount, setQuantity, removeItem, clear, loading, error, stockAdjusted } =
    useCart();
  const { user } = useAuth();
  const { ordersPaused, message: pausedMessage, pausedUntil } = useStoreStatus();
  const { navigate } = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel) {
        const f = panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="gg-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className="gg-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        ref={panelRef}
      >
        <div className="gg-drawer-head">
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
            Your cart ({itemCount})
          </h2>
          <button
            className="gg-iconbtn"
            style={{ color: "var(--gg-ink)", borderColor: "var(--gg-line)" }}
            onClick={onClose}
            data-autofocus
            aria-label="Close cart"
          >
            ✕
          </button>
        </div>

        <div className="gg-drawer-body">
          {error && (
            <p className="gg-alert gg-alert-error" role="alert">
              {error}
            </p>
          )}
          {stockAdjusted && (
            <p className="gg-alert gg-alert-warn" role="status">
              Some items were adjusted to match current availability.
            </p>
          )}
          {loading && <p role="status">Loading your cart…</p>}
          {!loading && lines.length === 0 && (
            <div className="gg-empty">
              <p>Your cart is empty.</p>
              <Link
                to="/shop"
                className="gg-btn gg-btn-ghost"
                onClick={onClose}
              >
                Browse singles
              </Link>
            </div>
          )}

          {lines.map((l) => (
            <div className="gg-line" key={l.inventoryItemId}>
              {l.imageUrl ? (
                <img
                  className="gg-line-img"
                  src={l.imageUrl}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="gg-line-img" aria-hidden="true" />
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
                  {l.setName ?? l.setCode?.toUpperCase()} · {l.condition}
                  {l.finish !== "nonfoil" ? ` · ${l.finish}` : ""}
                </div>
                <div className="gg-card-meta">{formatCents(l.priceCents)} each</div>
                {l.quantity >= l.sellable && (
                  <div className="gg-card-meta" style={{ color: "#92400e" }}>
                    Max available: {l.sellable}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginTop: "0.4rem",
                  }}
                >
                  <div className="gg-qty">
                    <button
                      onClick={() =>
                        setQuantity(l.inventoryItemId, l.quantity - 1)
                      }
                      aria-label={`Decrease ${l.name} quantity`}
                    >
                      −
                    </button>
                    <span aria-live="polite">{l.quantity}</span>
                    <button
                      onClick={() =>
                        setQuantity(l.inventoryItemId, l.quantity + 1)
                      }
                      disabled={l.quantity >= l.sellable}
                      aria-label={`Increase ${l.name} quantity`}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="gg-btn gg-btn-ghost gg-btn-sm"
                    onClick={() => removeItem(l.inventoryItemId)}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div className="gg-price">
                {formatCents(l.priceCents * l.quantity)}
              </div>
            </div>
          ))}
        </div>

        {lines.length > 0 && (
          <div className="gg-drawer-foot">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "0.75rem",
              }}
            >
              <strong>Subtotal</strong>
              <strong>{formatCents(subtotalCents)}</strong>
            </div>
            <p className="gg-card-meta" style={{ marginTop: 0 }}>
              Shipping & store credit are calculated at checkout.
            </p>
            {ordersPaused && (
              <p className="gg-paused-note" role="status">
                {pausedMessage}
                {pausedUntil && <> Checkout reopens {formatReopenDate(pausedUntil)}.</>}
              </p>
            )}
            <button
              className="gg-btn"
              style={{ width: "100%", marginBottom: "0.5rem" }}
              disabled={ordersPaused}
              onClick={() => {
                onClose();
                navigate(user ? "/checkout" : "/login?next=/checkout");
              }}
            >
              {ordersPaused ? "Checkout paused" : user ? "Checkout" : "Sign in to check out"}
            </button>
            <button
              className="gg-btn gg-btn-ghost gg-btn-sm"
              style={{ width: "100%" }}
              onClick={() => clear()}
            >
              Empty cart
            </button>
          </div>
        )}
      </div>
    </>
  );
}
