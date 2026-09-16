import { useState } from "react";
import { useCatalog, DEFAULT_FILTERS, type CatalogCard } from "../lib/useCatalog";
import { formatCents } from "../lib/money";

// The in-store kiosk. Runs on a computer physically in the shop — NOT the
// staff register (see the admin "Register" page) and NOT the regular
// storefront checkout. A customer standing in the store searches inventory
// themselves, builds a pickup list, and submits it with just their name (no
// account needed). Staff then see it queue up in the admin "Pickup Requests"
// page, pull the physical cards while the customer keeps browsing, and
// collect payment once everything's gathered.
//
// Deliberately unauthenticated and cart-independent: this never touches
// CartContext/AuthContext (see App.tsx, which renders this route standalone,
// without Header/Footer/Cart/Auth) so nothing here can leak into or be
// confused with a signed-in customer's own account or cart on a shared,
// walk-up store computer.

type KioskLine = {
  card: CatalogCard;
  quantity: number;
};

type Phase = "browsing" | "details" | "submitted";

export default function KioskPage() {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<KioskLine[]>([]);
  const [phase, setPhase] = useState<Phase>("browsing");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { cards, loading } = useCatalog(
    { ...DEFAULT_FILTERS, query },
    0,
  );

  function addToList(card: CatalogCard) {
    setList((prev) => {
      const existing = prev.find((l) => l.card.id === card.id);
      if (existing) {
        if (existing.quantity >= card.quantity) return prev;
        return prev.map((l) => (l.card.id === card.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { card, quantity: 1 }];
    });
  }

  function setQuantity(cardId: string, quantity: number) {
    setList((prev) =>
      prev
        .map((l) => (l.card.id === cardId ? { ...l, quantity: Math.max(0, quantity) } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(cardId: string) {
    setList((prev) => prev.filter((l) => l.card.id !== cardId));
  }

  function startOver() {
    setList([]);
    setCustomerName("");
    setPhone("");
    setError(null);
    setPhase("browsing");
  }

  async function submit() {
    if (!customerName.trim()) {
      setError("Please enter your name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kiosk/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          phone: phone || undefined,
          items: list.map((l) => ({ inventoryItemId: l.card.id, quantity: l.quantity })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error(body?.message || "Could not submit your pickup list. Please ask staff for help.");
      }
      setPhase("submitted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const totalCents = list.reduce((sum, l) => sum + (l.card.priceCents ?? 0) * l.quantity, 0);

  if (phase === "submitted") {
    return (
      <div className="gg-kiosk gg-kiosk--done">
        <h1>You're all set, {customerName}! 🎉</h1>
        <p>
          Staff are pulling your cards now. Feel free to keep browsing the shop — we'll come find
          you when everything's ready to pay for.
        </p>
        <button className="gg-btn gg-kiosk__restart" onClick={startOver}>
          Start a new pickup list
        </button>
      </div>
    );
  }

  if (phase === "details") {
    return (
      <div className="gg-kiosk">
        <h1>Almost done</h1>
        <p className="gg-card-meta">So staff know who's picking these up.</p>
        {error && (
          <div className="gg-alert gg-alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="gg-kiosk__form">
          <label>
            Your name
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              autoFocus
              placeholder="First name is fine"
            />
          </label>
          <label>
            Phone (optional)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="In case staff need to reach you"
            />
          </label>
        </div>
        <div className="gg-kiosk__list">
          {list.map((line) => (
            <div className="gg-line" key={line.card.id}>
              <div className="gg-line-info">
                <div className="gg-card-name">{line.card.name}</div>
                <div className="gg-card-meta">
                  {line.card.setName ?? line.card.set} × {line.quantity}
                </div>
              </div>
              <div className="gg-price">{formatCents((line.card.priceCents ?? 0) * line.quantity)}</div>
            </div>
          ))}
        </div>
        <div className="gg-kiosk__total">Estimated total: {formatCents(totalCents)}</div>
        <p className="gg-card-meta">
          This is an estimate — staff will confirm final pricing when you check out.
        </p>
        <div className="gg-kiosk__actions">
          <button className="gg-btn gg-btn-ghost" onClick={() => setPhase("browsing")}>
            Back
          </button>
          <button className="gg-btn" disabled={submitting} onClick={submit}>
            {submitting ? "Submitting…" : "Submit pickup request"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gg-kiosk">
      <h1>Find your cards</h1>
      <p className="gg-card-meta">
        Search our full inventory below, build your list, and staff will pull everything for you
        while you keep browsing.
      </p>
      <input
        className="gg-kiosk__search"
        type="search"
        placeholder="Search by card name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      <div className="gg-kiosk__body">
        <div className="gg-kiosk__results">
          {loading && <p className="gg-card-meta">Searching…</p>}
          {!loading && query.trim().length >= 2 && cards.length === 0 && (
            <p className="gg-card-meta">No in-stock cards match “{query}”.</p>
          )}
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              className="gg-line gg-kiosk__result"
              onClick={() => addToList(card)}
            >
              {card.imageUrl && <img className="gg-line-img" src={card.imageUrl} alt="" loading="lazy" />}
              <div className="gg-line-info">
                <div className="gg-card-name">{card.name}</div>
                <div className="gg-card-meta">
                  {card.setName ?? card.set} · {card.condition} · {card.quantity} in stock
                </div>
              </div>
              <div className="gg-price">{formatCents(card.priceCents)}</div>
            </button>
          ))}
        </div>

        <aside className="gg-kiosk__cart">
          <h2>Your list</h2>
          {list.length === 0 ? (
            <p className="gg-card-meta">Search and tap a card to add it here.</p>
          ) : (
            <>
              {list.map((line) => (
                <div className="gg-line" key={line.card.id}>
                  <div className="gg-line-info">
                    <div className="gg-card-name">{line.card.name}</div>
                    <div className="gg-card-meta">{formatCents(line.card.priceCents)} each</div>
                  </div>
                  <div className="gg-kiosk__qty">
                    <button
                      type="button"
                      onClick={() => setQuantity(line.card.id, line.quantity - 1)}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span>{line.quantity}</span>
                    <button
                      type="button"
                      disabled={line.quantity >= line.card.quantity}
                      onClick={() => setQuantity(line.card.id, line.quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="gg-kiosk__remove"
                    onClick={() => removeLine(line.card.id)}
                    aria-label={`Remove ${line.card.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="gg-kiosk__total">Estimated total: {formatCents(totalCents)}</div>
              <button className="gg-btn gg-kiosk__continue" onClick={() => setPhase("details")}>
                Continue
              </button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
