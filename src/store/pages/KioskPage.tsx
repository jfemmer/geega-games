import { useEffect, useMemo, useState } from "react";
import {
  useCatalog,
  useFacets,
  DEFAULT_FILTERS,
  PAGE_SIZE,
  type CatalogCard,
  type CatalogFilters,
  type CatalogSort,
} from "../lib/useCatalog";
import { formatCents } from "../lib/money";
import KioskProductCard from "../components/KioskProductCard";

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
// walk-up store computer. Browsing (filters, sort, card grid) deliberately
// mirrors the real Shop page's look and feel — same brand, same components
// where they don't depend on a cart — rather than a stripped-down page.

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const SORTS: { value: CatalogSort; label: string }[] = [
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
  { value: "price_asc", label: "Price low → high" },
  { value: "price_desc", label: "Price high → low" },
  { value: "newest", label: "Newest" },
];

type KioskLine = {
  card: CatalogCard;
  quantity: number;
};

type Phase = "browsing" | "details" | "submitted";

export default function KioskPage() {
  const [filters, setFilters] = useState<CatalogFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [list, setList] = useState<KioskLine[]>([]);
  const [phase, setPhase] = useState<Phase>("browsing");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facets = useFacets();
  const { cards, total, loading, error: catalogError } = useCatalog(filters, page);

  useEffect(() => {
    setPage(0);
  }, [filters.query, filters.sort, filters.sets, filters.rarities, filters.conditions]);

  const toggle = (key: "sets" | "rarities" | "conditions", value: string) => {
    setFilters((f) => {
      const arr = f[key];
      return { ...f, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  };

  const activeFilterCount =
    filters.sets.length + filters.rarities.length + filters.conditions.length;

  function quantityInList(cardId: string): number {
    return list.find((l) => l.card.id === cardId)?.quantity ?? 0;
  }

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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const listTotalCents = list.reduce((sum, l) => sum + (l.card.priceCents ?? 0) * l.quantity, 0);

  const FiltersPanel = useMemo(
    () => (
      <>
        {facets?.sets && facets.sets.length > 0 && (
          <div className="gg-filter-group">
            <h3>Set</h3>
            {facets.sets.slice(0, 30).map((s) => (
              <label className="gg-check" key={s.code}>
                <input
                  type="checkbox"
                  checked={filters.sets.includes(s.code)}
                  onChange={() => toggle("sets", s.code)}
                />
                {s.name}
              </label>
            ))}
          </div>
        )}
        {facets?.rarities && facets.rarities.length > 0 && (
          <div className="gg-filter-group">
            <h3>Rarity</h3>
            {facets.rarities.map((r) => (
              <label className="gg-check" key={r}>
                <input
                  type="checkbox"
                  checked={filters.rarities.includes(r)}
                  onChange={() => toggle("rarities", r)}
                />
                {r}
              </label>
            ))}
          </div>
        )}
        <div className="gg-filter-group">
          <h3>Condition</h3>
          {CONDITIONS.map((c) => (
            <label className="gg-check" key={c}>
              <input
                type="checkbox"
                checked={filters.conditions.includes(c)}
                onChange={() => toggle("conditions", c)}
              />
              {c}
            </label>
          ))}
        </div>
        {activeFilterCount > 0 && (
          <button className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear filters ({activeFilterCount})
          </button>
        )}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facets, filters.sets, filters.rarities, filters.conditions, activeFilterCount],
  );

  if (phase === "submitted") {
    return (
      <div className="gg-page gg-kiosk-page">
        <KioskTopBar />
        <div className="gg-page gg-empty">
          <h1>You're all set, {customerName}! 🎉</h1>
          <p>
            Staff are pulling your cards now. Feel free to keep browsing the shop — we'll come
            find you when everything's ready to pay for.
          </p>
          <button className="gg-btn" onClick={startOver}>
            Start a new pickup list
          </button>
        </div>
      </div>
    );
  }

  if (phase === "details") {
    return (
      <div className="gg-page gg-kiosk-page">
        <KioskTopBar />
        <h1 style={{ color: "var(--gg-ink)" }}>Almost done</h1>
        {error && (
          <div className="gg-alert gg-alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="gg-shop gg-kiosk-details">
          <div>
            <h2>Your info</h2>
            <p className="gg-card-meta">So staff know who's picking these up.</p>
            <div className="gg-form" style={{ maxWidth: "none" }}>
              <div className="gg-field">
                <label>Your name</label>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  autoFocus
                  placeholder="First name is fine"
                />
              </div>
              <div className="gg-field">
                <label>Phone (optional)</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="In case staff need to reach you"
                />
              </div>
            </div>
          </div>

          <aside className="gg-filters" style={{ alignSelf: "start" }}>
            <h2 style={{ marginTop: 0 }}>Your list</h2>
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
            <div className="gg-kiosk-total">Estimated total: {formatCents(listTotalCents)}</div>
            <p className="gg-card-meta">Staff will confirm final pricing at checkout.</p>
            <div className="gg-kiosk-actions">
              <button className="gg-btn gg-btn-ghost" onClick={() => setPhase("browsing")}>
                Back
              </button>
              <button className="gg-btn" disabled={submitting} onClick={submit}>
                {submitting ? "Submitting…" : "Submit pickup request"}
              </button>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="gg-page gg-kiosk-page">
      <KioskTopBar />

      <div className="gg-kiosk-search">
        <input
          type="search"
          placeholder="Search by card name…"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          autoFocus
        />
      </div>

      <div className="gg-shop gg-kiosk-shop">
        <aside className="gg-filters gg-filters-desktop" aria-label="Filters">
          {FiltersPanel}
        </aside>

        <div>
          <div className="gg-toolbar">
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button
                className="gg-btn gg-btn-ghost gg-btn-sm gg-mobile-filter-btn"
                onClick={() => setMobileFiltersOpen(true)}
              >
                ⚙ Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
              </button>
              <p className="gg-card-meta" role="status" aria-live="polite" style={{ margin: 0 }}>
                {loading ? "Loading…" : `${total} result${total === 1 ? "" : "s"}`}
              </p>
            </div>
            <label>
              <span className="visually-hidden">Sort</span>
              <select
                value={filters.sort}
                onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as CatalogSort }))}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {catalogError && (
            <div className="gg-alert gg-alert-error" role="alert">
              {catalogError}
            </div>
          )}

          {loading ? (
            <div className="gg-grid" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div className="gg-card" key={i}>
                  <div className="gg-card-imgwrap">
                    <div className="gg-card-img gg-skeleton" />
                  </div>
                  <div className="gg-card-body">
                    <div className="gg-skeleton" style={{ height: 16 }} />
                    <div className="gg-skeleton" style={{ height: 12, width: "60%" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : cards.length === 0 && !catalogError ? (
            <div className="gg-empty">
              <p>
                {filters.query.trim() || activeFilterCount > 0
                  ? "No cards match your search."
                  : "Nothing's available to browse right now — check back soon, or ask staff what's new in stock."}
              </p>
              {(filters.query.trim() || activeFilterCount > 0) && (
                <button className="gg-btn gg-btn-ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Clear search &amp; filters
                </button>
              )}
            </div>
          ) : (
            <div className="gg-grid">
              {cards.map((c) => (
                <KioskProductCard
                  key={c.id}
                  card={c}
                  quantityInList={quantityInList(c.id)}
                  onAdd={() => addToList(c)}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="gg-pagination">
              <button className="gg-btn gg-btn-ghost" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                ← Previous
              </button>
              <span aria-live="polite">
                Page {page + 1} of {totalPages}
              </span>
              <button className="gg-btn gg-btn-ghost" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next →
              </button>
            </div>
          )}
        </div>

        <aside className="gg-filters gg-kiosk-list" aria-label="Your pickup list">
          <h2 style={{ marginTop: 0 }}>Your list</h2>
          {list.length === 0 ? (
            <p className="gg-card-meta">Tap "Add to list" on a card to start.</p>
          ) : (
            <>
              {list.map((line) => (
                <div className="gg-line" key={line.card.id}>
                  <div className="gg-line-info">
                    <div className="gg-card-name">{line.card.name}</div>
                    <div className="gg-card-meta">{formatCents(line.card.priceCents)} each</div>
                  </div>
                  <div className="gg-kiosk-qty">
                    <button type="button" onClick={() => setQuantity(line.card.id, line.quantity - 1)} aria-label="Decrease quantity">
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
                    className="gg-kiosk-remove"
                    onClick={() => removeLine(line.card.id)}
                    aria-label={`Remove ${line.card.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="gg-kiosk-total">Estimated total: {formatCents(listTotalCents)}</div>
              <button className="gg-btn" style={{ width: "100%", marginTop: "0.5rem" }} onClick={() => setPhase("details")}>
                Continue
              </button>
            </>
          )}
        </aside>
      </div>

      {mobileFiltersOpen && (
        <>
          <div className="gg-drawer-overlay" onClick={() => setMobileFiltersOpen(false)} aria-hidden="true" />
          <div className="gg-drawer" role="dialog" aria-modal="true" aria-label="Filters">
            <div className="gg-drawer-head">
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Filters</h2>
              <button
                className="gg-iconbtn"
                style={{ color: "var(--gg-ink)", borderColor: "var(--gg-line)" }}
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Close filters"
              >
                ✕
              </button>
            </div>
            <div className="gg-drawer-body">{FiltersPanel}</div>
            <div className="gg-drawer-foot">
              <button className="gg-btn" style={{ width: "100%" }} onClick={() => setMobileFiltersOpen(false)}>
                Show {total} result{total === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KioskTopBar() {
  return (
    <div className="gg-kiosk-topbar">
      <img className="gg-logo" src="/logo.png" alt="Geega Games" />
      <div>
        <h1>Find your cards</h1>
        <p className="gg-card-meta">
          Search our full inventory, build your pickup list, and staff will pull everything while
          you keep browsing.
        </p>
      </div>
    </div>
  );
}
