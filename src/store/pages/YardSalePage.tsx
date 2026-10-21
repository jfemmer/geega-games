import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  countActiveFilters,
  useCatalog,
  useFacets,
  type CatalogCard,
  type CatalogFilters,
  type CatalogSort,
} from "../lib/useCatalog";
import { formatCents } from "../lib/money";
import { CONDITION_LABELS } from "../lib/conditionLabels";
import KioskProductCard from "../components/KioskProductCard";
import PriceCell from "../components/YardSalePriceCell";
import YardSaleDeckSheet from "../components/YardSaleDeckSheet";
import { useSheet } from "../lib/useSheet";
import { Icon } from "../components/Icon";
import type { DeckFoundLine } from "../lib/yardSaleDeck";
import CatalogFiltersPanel from "../components/CatalogFiltersPanel";
import {
  YARD_SALE_EXCLUSIVE_LINE,
  YARD_SALE_LIMITS,
  yardSaleCardsLine,
  yardSaleExclusiveNote,
  yardSalePriceCents,
  yardSaleTotals,
  type YardSaleListAccess,
  type YardSaleListView,
  type YardSaleTotals,
} from "../lib/yardSale";
import {
  NO_YARD_SALE,
  YardSaleApiError,
  addToYardSaleList,
  clearSavedList,
  getYardSaleList,
  loadYardSaleStatus,
  readSavedList,
  saveList,
  sendYardSaleList,
  type YardSaleStatus,
} from "../lib/yardSaleApi";

// /yard-sale — what the QR code at our yard sale opens. A shopper sees our
// in-stock cards at or above the sale's minimum price, with the yard sale
// discount, taps the ones they want and sends the list with their name.
// The discount is shown as what it is, a yard sale exclusive: the offer at
// the top, the website price next to each card's, and the savings in a list
// all say it can't be had on the website.
// Their phone shows a pickup number; staff grab the cards while they keep
// browsing the tables, and they pay in person for everything together.
//
// Standalone like the kiosk (App.tsx renders it without the header, cart or
// account), so nothing here touches anyone's cart or checkout. The phone
// remembers its list, so a reload or a locked screen keeps the number, and
// "Add more cards" adds to the same list while the sale is on.

const SORTS: { value: CatalogSort; label: string }[] = [
  { value: "price_desc", label: "Price high → low" },
  { value: "price_asc", label: "Price low → high" },
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
  { value: "newest", label: "Newest" },
];

const STATUS_REFRESH_MS = 2 * 60_000;

type DraftLine = { card: CatalogCard; quantity: number };
type Phase = "loading" | "error" | "closed" | "browsing" | "list";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type StartState =
  | { kind: "error"; message: string }
  | { kind: "ready"; status: YardSaleStatus; access: YardSaleListAccess | null; list: YardSaleListView | null };

/** Whether a sale is on, and the open list this phone sent (if it still is open). */
async function resolveStart(): Promise<StartState> {
  let status: YardSaleStatus;
  try {
    status = await loadYardSaleStatus();
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : "We couldn't load the yard sale." };
  }
  const saved = readSavedList();
  if (saved) {
    try {
      const view = await getYardSaleList(saved);
      if (view.status === "open") return { kind: "ready", status, access: saved, list: view };
      clearSavedList();
    } catch (err) {
      if (err instanceof YardSaleApiError && (err.status === 404 || err.code === "not_found")) clearSavedList();
    }
  }
  return { kind: "ready", status, access: null, list: null };
}

export default function YardSalePage() {
  const [status, setStatus] = useState<YardSaleStatus>(NO_YARD_SALE);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [access, setAccess] = useState<YardSaleListAccess | null>(null);
  const [list, setList] = useState<YardSaleListView | null>(null);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [filters, setFilters] = useState<CatalogFilters>({ ...DEFAULT_FILTERS, sort: "price_desc" });
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    document.title = "Yard sale cards | Geega Games";
  }, []);

  // The catalog, never below the sale's minimum price.
  const catalogFilters = useMemo<CatalogFilters>(
    () => ({
      ...filters,
      minPriceCents: Math.max(status.minPriceCents, filters.minPriceCents ?? 0) || null,
    }),
    [filters, status.minPriceCents],
  );
  // Back to the first page whenever the search or filters change.
  const filterKey = JSON.stringify(catalogFilters);
  const [paging, setPaging] = useState({ key: filterKey, page: 0 });
  const page = paging.key === filterKey ? paging.page : 0;
  const setPage = (update: (p: number) => number) => setPaging({ key: filterKey, page: update(page) });

  const facets = useFacets();
  const { cards, total, loading, error: catalogError, refetch } = useCatalog(catalogFilters, page);

  const openList = list && list.status === "open" ? list : null;
  const adding = !!access && !!openList;

  // ---------------------------------------------------------------- loading
  const applyStart = useCallback((start: StartState) => {
    if (start.kind === "error") {
      setLoadError(start.message);
      setPhase("error");
      return;
    }
    setStatus(start.status);
    if (start.access && start.list) {
      setAccess(start.access);
      setList(start.list);
      setName(start.list.customerName);
      setPhase("list");
      return;
    }
    setPhase(start.status.active ? "browsing" : "closed");
  }, []);

  useEffect(() => {
    let alive = true;
    void resolveStart().then((start) => {
      if (alive) applyStart(start);
    });
    return () => {
      alive = false;
    };
  }, [applyStart]);

  function retry() {
    setPhase("loading");
    setLoadError(null);
    void resolveStart().then(applyStart);
  }

  // Keep the discount, minimum and end time current while the page is open.
  useEffect(() => {
    if (phase === "loading" || phase === "error") return;
    const refresh = async () => {
      try {
        const next = await loadYardSaleStatus();
        setStatus(next);
        if (!next.active) {
          setSheetOpen(false);
          setDeckOpen(false);
          setPhase((p) => (p === "browsing" ? (openList ? "list" : "closed") : p));
        }
      } catch {
        // Keep what we have; the server checks everything anyway.
      }
    };
    const timer = window.setInterval(() => void refresh(), STATUS_REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [phase, openList]);

  // ---------------------------------------------------------------- the draft
  function quantityInDraft(cardId: string): number {
    return draft.find((l) => l.card.id === cardId)?.quantity ?? 0;
  }

  function addToDraft(card: CatalogCard) {
    setDraft((prev) => {
      const existing = prev.find((l) => l.card.id === card.id);
      if (existing) {
        if (existing.quantity >= Math.min(card.quantity, YARD_SALE_LIMITS.copiesPerCard)) return prev;
        return prev.map((l) => (l.card.id === card.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (prev.length >= YARD_SALE_LIMITS.linesPerSend) return prev;
      return [...prev, { card, quantity: 1 }];
    });
  }

  function setDraftQuantity(cardId: string, quantity: number) {
    setDraft((prev) =>
      prev
        .map((l) => (l.card.id === cardId ? { ...l, quantity: Math.max(0, quantity) } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  // "Shop your deck": its cards join the draft (a card already there gets
  // more copies, as far as we have), then the list opens to send.
  function addDeckToDraft(lines: DeckFoundLine[]) {
    setDraft((prev) => {
      const next = prev.map((l) => ({ ...l }));
      for (const line of lines) {
        const max = Math.min(line.card.quantity, YARD_SALE_LIMITS.copiesPerCard);
        const existing = next.find((l) => l.card.id === line.card.id);
        if (existing) existing.quantity = Math.min(max, existing.quantity + line.quantity);
        else if (next.length < YARD_SALE_LIMITS.linesPerSend) next.push({ card: line.card, quantity: Math.min(max, line.quantity) });
      }
      return next;
    });
    setDeckOpen(false);
    setSheetError(null);
    setSheetOpen(true);
  }

  // Different cards "Shop your deck" can still add: what one send takes,
  // and when adding to a list, what the list has room for.
  const deckLinesLeft = Math.max(
    0,
    Math.min(
      YARD_SALE_LIMITS.linesPerSend,
      adding && openList ? YARD_SALE_LIMITS.linesPerList - openList.lines.length : YARD_SALE_LIMITS.linesPerSend,
    ) - draft.length,
  );

  const draftTotals = yardSaleTotals(
    draft.map((l) => ({ priceCents: l.card.priceCents ?? 0, quantity: l.quantity })),
    status.discountPercent,
    status.taxBps,
  );
  const draftCards = draft.reduce((sum, l) => sum + l.quantity, 0);

  // ---------------------------------------------------------------- send / add
  function showList(view: YardSaleListView) {
    setList(view);
    setDraft([]);
    setSheetOpen(false);
    setSheetError(null);
    setNotice(null);
    setPhase("list");
    window.scrollTo({ top: 0 });
    void refetch();
  }

  async function handleFailure(err: unknown) {
    const e = err instanceof YardSaleApiError ? err : null;
    if (e?.code === "sale_ended") {
      setSheetOpen(false);
      try {
        setStatus(await loadYardSaleStatus());
      } catch {
        setStatus(NO_YARD_SALE);
      }
      setNotice("The yard sale has ended, so we can't take new cards.");
      setPhase(openList ? "list" : "closed");
      return;
    }
    if (adding && (e?.code === "list_closed" || e?.code === "not_found")) {
      // Paid for or closed at the table: send these as a new list instead.
      const message = `List #${openList?.pickupNumber ?? ""} is already closed, so send these as a new list.`;
      clearSavedList();
      setAccess(null);
      setList(null);
      setSheetError(message);
      setNotice(message);
      return;
    }
    if (e?.code === "unavailable") void refetch();
    setSheetError(err instanceof Error ? err.message : "Something went wrong. Please ask us for help.");
  }

  async function submit() {
    if (draft.length === 0 || busy) return;
    const items = draft.map((l) => ({ inventoryItemId: l.card.id, quantity: l.quantity }));
    setSheetError(null);

    if (adding && access) {
      setBusy(true);
      try {
        showList(await addToYardSaleList(access, items));
      } catch (err) {
        await handleFailure(err);
      } finally {
        setBusy(false);
      }
      return;
    }

    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      setSheetError("Please tell us your name, so we know whose cards these are.");
      return;
    }
    if (!status.saleId) return;
    setBusy(true);
    try {
      const result = await sendYardSaleList(trimmed, items, website);
      const nextAccess = { requestId: result.list.requestId, token: result.token, saleId: status.saleId };
      saveList(nextAccess);
      setAccess(nextAccess);
      showList(result.list);
    } catch (err) {
      await handleFailure(err);
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- screens
  if (phase === "loading") {
    return (
      <div className="gg-page gg-kiosk-page gg-yard-page">
        <YardSaleTopBar status={null} />
        <p className="gg-card-meta" role="status">
          Loading the yard sale…
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="gg-page gg-kiosk-page gg-yard-page">
        <YardSaleTopBar status={null} />
        <div className="gg-empty gg-yard-message" role="alert">
          <h2>We couldn&rsquo;t load the yard sale</h2>
          <p>{loadError}</p>
          <button type="button" className="gg-btn" onClick={retry}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (phase === "closed") {
    return (
      <div className="gg-page gg-kiosk-page gg-yard-page">
        <YardSaleTopBar status={null} />
        <div className="gg-empty gg-yard-message">
          <h2>No yard sale right now</h2>
          {notice && <p className="gg-yard-notice">{notice}</p>}
          <p>This page opens when we&rsquo;re having a yard sale. You can always shop our cards online.</p>
          <a className="gg-btn" href="/shop">
            Shop our cards
          </a>
        </div>
      </div>
    );
  }

  if (phase === "list" && list) {
    return (
      <div className="gg-page gg-kiosk-page gg-yard-page">
        <YardSaleTopBar status={status.active ? status : null} offer={false} />
        <YardSaleListScreen
          list={list}
          saleOn={status.active}
          notice={notice}
          onAddMore={() => {
            setNotice(null);
            setPhase("browsing");
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    );
  }

  const activeFilterCount = countActiveFilters(filters);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const FiltersPanel = <CatalogFiltersPanel facets={facets} filters={filters} setFilters={setFilters} />;

  return (
    <div className="gg-page gg-kiosk-page gg-yard-page gg-yard-page--browsing">
      <YardSaleTopBar status={status} />

      {notice && (
        <div className="gg-alert gg-yard-notice" role="status">
          {notice}
        </div>
      )}
      {adding && openList && (
        <div className="gg-yard-adding" role="status">
          <span>
            Adding to <strong>list #{openList.pickupNumber}</strong>
          </span>
          <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => setPhase("list")}>
            Back to my list
          </button>
        </div>
      )}

      <div className="gg-yard-deckcta">
        <Icon name="deck" size={22} />
        <p>
          <strong>Have a decklist?</strong>
          <span>Paste it and we&rsquo;ll find the cards we have here.</span>
        </p>
        <button type="button" className="gg-btn gg-btn-sm" onClick={() => setDeckOpen(true)}>
          Shop your deck
        </button>
      </div>

      <div className="gg-kiosk-search">
        <label htmlFor="gg-yard-search" className="visually-hidden">
          Search cards
        </label>
        <input
          id="gg-yard-search"
          type="search"
          placeholder="Search by card name…"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          enterKeyHint="search"
        />
      </div>

      <div className="gg-shop gg-yard-shop">
        <aside className="gg-filters gg-filters-desktop" aria-label="Filters">
          {FiltersPanel}
        </aside>

        <div>
          <div className="gg-toolbar">
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button
                type="button"
                className="gg-btn gg-btn-ghost gg-btn-sm gg-mobile-filter-btn"
                onClick={() => setFiltersOpen(true)}
              >
                ⚙ Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
              </button>
              <p className="gg-card-meta" role="status" aria-live="polite" style={{ margin: 0 }}>
                {loading ? "Loading…" : plural(total, "card")}
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
              {Array.from({ length: 6 }).map((_, i) => (
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
                  : "Nothing to show right now. Ask us what we have!"}
              </p>
              {(filters.query.trim() || activeFilterCount > 0) && (
                <button
                  type="button"
                  className="gg-btn gg-btn-ghost"
                  onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}
                >
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
                  quantityInList={quantityInDraft(c.id)}
                  onAdd={() => addToDraft(c)}
                  salePriceCents={
                    c.priceCents != null ? yardSalePriceCents(c.priceCents, status.discountPercent) : null
                  }
                  regularPriceLabel="Website"
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="gg-pagination">
              <button
                type="button"
                className="gg-btn gg-btn-ghost"
                disabled={page === 0}
                onClick={() => {
                  setPage((p) => Math.max(0, p - 1));
                  window.scrollTo({ top: 0 });
                }}
              >
                ← Previous
              </button>
              <span aria-live="polite">
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                className="gg-btn gg-btn-ghost"
                disabled={page + 1 >= totalPages}
                onClick={() => {
                  setPage((p) => p + 1);
                  window.scrollTo({ top: 0 });
                }}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="gg-yard-bar">
        {draft.length === 0 ? (
          <p className="gg-yard-bar__hint">
            {adding ? "Tap “Add to list” on more cards you want." : "Tap “Add to list” on the cards you want."}
          </p>
        ) : (
          <>
            <div className="gg-yard-bar__summary">
              <strong>{adding && openList ? `Adding to #${openList.pickupNumber}` : "Your list"}</strong>
              <span>
                {plural(draftCards, "card")} · {formatCents(draftTotals.totalCents)}
              </span>
            </div>
            <button
              type="button"
              className="gg-btn"
              onClick={() => {
                setSheetError(null);
                setSheetOpen(true);
              }}
            >
              {adding ? "Review & add" : "Review & send"}
            </button>
          </>
        )}
      </div>

      {sheetOpen && (
        <YardSaleSheet
          title={adding && openList ? `Add to list #${openList.pickupNumber}` : "Your list"}
          draft={draft}
          discountPercent={status.discountPercent}
          totals={draftTotals}
          adding={adding}
          name={name}
          setName={setName}
          website={website}
          setWebsite={setWebsite}
          busy={busy}
          error={sheetError}
          onQuantity={setDraftQuantity}
          onClose={() => setSheetOpen(false)}
          onSubmit={() => void submit()}
        />
      )}

      {deckOpen && (
        <YardSaleDeckSheet
          discountPercent={status.discountPercent}
          linesLeft={deckLinesLeft}
          onAdd={addDeckToDraft}
          onClose={() => setDeckOpen(false)}
        />
      )}

      {filtersOpen && (
        <>
          <div className="gg-drawer-overlay" onClick={() => setFiltersOpen(false)} aria-hidden="true" />
          <div className="gg-drawer" role="dialog" aria-modal="true" aria-label="Filters">
            <div className="gg-drawer-head">
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Filters</h2>
              <button
                type="button"
                className="gg-iconbtn"
                onClick={() => setFiltersOpen(false)}
                aria-label="Close filters"
              >
                ✕
              </button>
            </div>
            <div className="gg-drawer-body">{FiltersPanel}</div>
            <div className="gg-drawer-foot">
              <button type="button" className="gg-btn" style={{ width: "100%" }} onClick={() => setFiltersOpen(false)}>
                Show {plural(total, "card")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The page's header: while a sale is on, its exclusive discount (not on the
 * pickup screen, where the pickup number comes first and the list's savings
 * say it), the minimum price and how it works.
 */
function YardSaleTopBar({ status, offer = true }: { status: YardSaleStatus | null; offer?: boolean }) {
  const discount = status?.active && offer ? status.discountPercent : 0;
  return (
    <header className="gg-kiosk-topbar gg-yard-topbar">
      <img className="gg-logo" src="/logo.png" alt="Geega Games" width={600} height={480} />
      <div className="gg-yard-topbar__text">
        <h1>Yard sale cards</h1>
        {status?.active && (
          <>
            {discount > 0 && <YardSaleOffer discountPercent={discount} />}
            <p className="gg-yard-terms">{yardSaleCardsLine(status.minPriceCents)}</p>
            <p className="gg-card-meta">
              Tap the cards you want and send us your list. We&rsquo;ll grab them while you keep browsing, and you
              pay for everything together when you&rsquo;re done.
            </p>
          </>
        )}
      </div>
    </header>
  );
}

/**
 * The sale's discount as a coupon at the top of the page: how much, and
 * that it's a yard sale exclusive they won't get on the website. The prices
 * below already include it (rounded to whole dollars, so a card's saving
 * can be a little more or less than the percent).
 */
function YardSaleOffer({ discountPercent }: { discountPercent: number }) {
  return (
    <section className="gg-yard-offer" aria-label={`Yard sale exclusive: ${discountPercent}% off`}>
      <p className="gg-yard-offer__amount" aria-hidden="true">
        <strong>{discountPercent}%</strong>
        <span>off</span>
      </p>
      <div className="gg-yard-offer__text">
        <p className="gg-yard-offer__title">Yard sale exclusive</p>
        <p className="gg-yard-offer__line">{YARD_SALE_EXCLUSIVE_LINE}</p>
        <p className="gg-yard-offer__fine">The prices below already include it, rounded to the nearest dollar.</p>
      </div>
    </section>
  );
}

// "Savings", not "discount (20%)": prices round to whole dollars, so the
// savings aren't exactly the sale's percent (and there are some at 0%). The
// note under it says whose discount it is: the yard sale's exclusive one.
function TotalsBlock({ totals, discountPercent }: { totals: YardSaleTotals; discountPercent: number }) {
  return (
    <dl className="gg-yard-totals">
      {totals.discountCents > 0 && (
        <div className="gg-yard-totals__savings">
          <dt>
            Yard sale savings
            {discountPercent > 0 && <span className="gg-yard-totals__note">{yardSaleExclusiveNote(discountPercent)}</span>}
          </dt>
          <dd>−{formatCents(totals.discountCents)}</dd>
        </div>
      )}
      {totals.taxCents > 0 && (
        <>
          <div>
            <dt>Cards</dt>
            <dd>{formatCents(totals.cardsCents)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{formatCents(totals.taxCents)}</dd>
          </div>
        </>
      )}
      <div className="gg-yard-totals__total">
        <dt>Total for these cards</dt>
        <dd>{formatCents(totals.totalCents)}</dd>
      </div>
    </dl>
  );
}

function YardSaleSheet({
  title,
  draft,
  discountPercent,
  totals,
  adding,
  name,
  setName,
  website,
  setWebsite,
  busy,
  error,
  onQuantity,
  onClose,
  onSubmit,
}: {
  title: string;
  draft: DraftLine[];
  discountPercent: number;
  totals: YardSaleTotals;
  adding: boolean;
  name: string;
  setName: (v: string) => void;
  website: string;
  setWebsite: (v: string) => void;
  busy: boolean;
  error: string | null;
  onQuantity: (cardId: string, quantity: number) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const headingRef = useSheet(onClose);

  return (
    <>
      <div className="gg-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div className="gg-drawer gg-yard-sheet" role="dialog" aria-modal="true" aria-labelledby="gg-yard-sheet-title">
        <div className="gg-drawer-head">
          <h2 id="gg-yard-sheet-title" ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: "1.15rem" }}>
            {title}
          </h2>
          <button
            type="button"
            className="gg-iconbtn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form
          className="gg-drawer-body gg-yard-sheet__body"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {draft.length === 0 ? (
            <p className="gg-card-meta">Nothing here yet.</p>
          ) : (
            <ul className="gg-yard-lines">
              {draft.map((line) => {
                const price = line.card.priceCents ?? 0;
                const sale = yardSalePriceCents(price, discountPercent);
                const max = Math.min(line.card.quantity, YARD_SALE_LIMITS.copiesPerCard);
                return (
                  <li className="gg-yard-line" key={line.card.id}>
                    <div className="gg-yard-line__info">
                      <span className="gg-card-name">{line.card.name}</span>
                      <span className="gg-card-meta">
                        {line.card.setName ?? line.card.set?.toUpperCase()} ·{" "}
                        {CONDITION_LABELS[line.card.condition] ?? line.card.condition}
                        {line.card.finish !== "nonfoil" ? ` · ${line.card.finish}` : ""}
                      </span>
                    </div>
                    <div className="gg-kiosk-qty">
                      <button
                        type="button"
                        onClick={() => onQuantity(line.card.id, line.quantity - 1)}
                        aria-label={`One less ${line.card.name}`}
                      >
                        −
                      </button>
                      <span aria-label={`${line.quantity} on your list`}>{line.quantity}</span>
                      <button
                        type="button"
                        disabled={line.quantity >= max}
                        onClick={() => onQuantity(line.card.id, line.quantity + 1)}
                        aria-label={`One more ${line.card.name}`}
                      >
                        +
                      </button>
                    </div>
                    <PriceCell priceCents={price} salePriceCents={sale} quantity={line.quantity} />
                    <button
                      type="button"
                      className="gg-kiosk-remove"
                      onClick={() => onQuantity(line.card.id, 0)}
                      aria-label={`Remove ${line.card.name}`}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <TotalsBlock totals={totals} discountPercent={discountPercent} />
          <p className="gg-card-meta gg-yard-fine">
            You don&rsquo;t pay here. Pay us in person when you&rsquo;re done, together with anything from the tables.
          </p>

          {!adding && (
            <div className="gg-field gg-yard-name">
              <label htmlFor="gg-yard-name">Your name</label>
              <input
                id="gg-yard-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={YARD_SALE_LIMITS.nameMax}
                autoComplete="given-name"
                placeholder="First name is fine"
                required
              />
            </div>
          )}
          {/* Honeypot: hidden from people, filled in by bots. */}
          <div className="gg-referral-hp" aria-hidden="true">
            <label htmlFor="gg-yard-website">Website</label>
            <input
              id="gg-yard-website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          {error && (
            <div className="gg-alert gg-alert-error" role="alert">
              {error}
            </div>
          )}

          <div className="gg-kiosk-actions">
            <button type="button" className="gg-btn gg-btn-ghost" onClick={onClose}>
              Keep browsing
            </button>
            <button type="submit" className="gg-btn" disabled={busy || draft.length === 0}>
              {busy ? "Sending…" : adding ? "Add to my list" : "Send my list"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function YardSaleListScreen({
  list,
  saleOn,
  notice,
  onAddMore,
}: {
  list: YardSaleListView;
  saleOn: boolean;
  notice: string | null;
  onAddMore: () => void;
}) {
  const cards = list.lines.reduce((sum, l) => sum + l.quantity, 0);
  return (
    <section className="gg-yard-list" aria-labelledby="gg-yard-number">
      <div className="gg-yard-ticket">
        <p className="gg-yard-ticket__label">Your pickup number</p>
        <p id="gg-yard-number" className="gg-yard-ticket__number">
          #{list.pickupNumber}
        </p>
        <p className="gg-yard-ticket__name">
          Thanks, {list.customerName}! We&rsquo;re grabbing your {cards === 1 ? "card" : "cards"} now.
        </p>
      </div>

      {notice && <p className="gg-yard-notice">{notice}</p>}

      <ol className="gg-yard-steps">
        <li>Keep browsing the tables.</li>
        <li>When you&rsquo;re done, come pay for everything together.</li>
        <li>Show us this screen (or tell us #{list.pickupNumber}).</li>
      </ol>

      <h2 className="gg-yard-list__heading">
        Your list · {plural(cards, "card")}
      </h2>
      <ul className="gg-yard-lines">
        {list.lines.map((line) => (
          <li className="gg-yard-line gg-yard-line--sent" key={line.itemId}>
            <div className="gg-yard-line__info">
              <span className="gg-card-name">
                {line.cardName}
                {line.quantity > 1 ? ` × ${line.quantity}` : ""}
              </span>
              <span className="gg-card-meta">
                {line.setName ?? line.setCode?.toUpperCase()} · {CONDITION_LABELS[line.condition] ?? line.condition}
                {line.finish !== "nonfoil" ? ` · ${line.finish}` : ""}
              </span>
            </div>
            <PriceCell priceCents={line.priceCents} salePriceCents={line.salePriceCents} quantity={line.quantity} />
          </li>
        ))}
      </ul>
      <TotalsBlock totals={list.totals} discountPercent={list.discountPercent} />
      <p className="gg-card-meta gg-yard-fine">
        Changed your mind about a card? Just tell us when you pay. Your total is confirmed when you pay.
      </p>

      {list.canAdd && saleOn ? (
        <button type="button" className="gg-btn gg-yard-addmore" onClick={onAddMore}>
          Add more cards
        </button>
      ) : !saleOn ? (
        <p className="gg-yard-notice">The yard sale has ended. Come see us to pay for your list.</p>
      ) : null}
    </section>
  );
}
