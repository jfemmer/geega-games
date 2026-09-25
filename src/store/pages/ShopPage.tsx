import { useEffect, useState } from "react";
import { useRouter } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import {
  useCatalog,
  useFacets,
  DEFAULT_FILTERS,
  PAGE_SIZE,
  countActiveFilters,
  type CatalogFilters,
  type CatalogSort,
} from "../lib/useCatalog";
import ProductCard from "../components/ProductCard";
import CatalogFiltersPanel from "../components/CatalogFiltersPanel";
const SORTS: { value: CatalogSort; label: string }[] = [
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
  { value: "price_asc", label: "Price low → high" },
  { value: "price_desc", label: "Price high → low" },
  { value: "newest", label: "Newest" },
];

export default function ShopPage() {
  useSEO({
    title: "Shop Magic: The Gathering Singles Online | Geega Games",
    description:
      "Browse hand-picked Magic: The Gathering singles — search by card name, set, color, card type, or creature type. Honest condition grading, secure checkout, and fast shipping nationwide.",
    path: "/shop",
  });

  const { query: urlQuery, navigate } = useRouter();
  const [filters, setFilters] = useState<CatalogFilters>(() => ({
    ...DEFAULT_FILTERS,
    query: urlQuery.get("q") ?? "",
    dealsOnly: urlQuery.get("deals") === "1",
    sort: (urlQuery.get("sort") as CatalogSort) || "name_asc",
  }));
  const [page, setPage] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const facets = useFacets();
  const { cards, total, loading, error } = useCatalog(filters, page);

  // Sync URL -> filters. Catches every source that can change ?q=/?sort=
  // AFTER this page has already mounted: the header search box, browser
  // back/forward, a nav link like "New arrivals" (?sort=newest), or a
  // pasted/bookmarked search link. `urlQuery` is a stable reference that only
  // changes identity when the actual URL search string changes (see
  // RouterProvider), so this does not run on every render.
  useEffect(() => {
    const q = urlQuery.get("q") ?? "";
    const dealsOnly = urlQuery.get("deals") === "1";
    const sort = (urlQuery.get("sort") as CatalogSort) || "name_asc";
    setFilters((f) =>
      f.query === q && f.sort === sort && f.dealsOnly === dealsOnly
        ? f
        : { ...f, query: q, sort, dealsOnly },
    );
  }, [urlQuery]);

  // Reflect filters -> URL (shareable/bookmarkable) without spamming history
  // — always replace. Goes through the router's navigate() (not a raw
  // history.replaceState) so RouterProvider's own query state stays the
  // source of truth; the target-vs-current check below stops this from
  // fighting the URL -> filters effect above (each only ever no-ops the
  // other instead of looping).
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.query) params.set("q", filters.query);
    if (filters.dealsOnly) params.set("deals", "1");
    if (filters.sort !== "name_asc") params.set("sort", filters.sort);
    const qs = params.toString();
    const target = qs ? `/shop?${qs}` : "/shop";
    const current = `${window.location.pathname}${window.location.search}`;
    if (target !== current) {
      navigate(target, { replace: true });
    }
  }, [filters.query, filters.dealsOnly, filters.sort, navigate]);

  // Reset to first page whenever the filter set changes.
  useEffect(() => {
    setPage(0);
  }, [
    filters.query,
    filters.sort,
    filters.sets,
    filters.rarities,
    filters.conditions,
    filters.colorGroups,
    filters.cardTypes,
    filters.creatureTypes,
    filters.minPriceCents,
    filters.maxPriceCents,
    filters.dealsOnly,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const activeFilterCount = countActiveFilters(filters);

  const FiltersPanel = (
    <CatalogFiltersPanel facets={facets} filters={filters} setFilters={setFilters} />
  );

  return (
    <div className="gg-page">
      {/* The deals view has its own visible heading; the main grid needs one
          too for screen readers and search engines, without changing the layout. */}
      {!filters.dealsOnly && <h1 className="visually-hidden">Magic: The Gathering singles</h1>}
      {filters.dealsOnly && (
        <section className="gg-deals-hero" aria-labelledby="gg-deals-title">
          <div>
            <span className="gg-deals-kicker">Deals & Specials</span>
            <h1 id="gg-deals-title">Save on singles</h1>
            <p>
              Hand-picked specials, cards automatically marked down after
              they’ve been in stock for 30 days, and cards with a hard-to-grade
              flaw — always noted so you know exactly what you’re getting.
            </p>
          </div>
          <button
            className="gg-btn gg-btn-ghost"
            onClick={() => setFilters((f) => ({ ...f, dealsOnly: false }))}
          >
            Browse all cards
          </button>
        </section>
      )}
      <div className="gg-shop">
        <aside className="gg-filters gg-filters-desktop" aria-label="Filters">
          {FiltersPanel}
        </aside>

        <div>
          <div className="gg-toolbar">
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button
                className="gg-btn gg-btn-ghost gg-btn-sm gg-mobile-filter-btn"
                onClick={() => setMobileFiltersOpen(true)}
                aria-expanded={mobileFiltersOpen}
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
                onChange={(e) =>
                  setFilters((f) => ({ ...f, sort: e.target.value as CatalogSort }))
                }
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <div className="gg-alert gg-alert-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="gg-grid" aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
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
          ) : cards.length === 0 && !error ? (
            <div className="gg-empty">
              <p>No cards match your search.</p>
              {activeFilterCount > 0 && (
                <button
                  className="gg-btn gg-btn-ghost"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="gg-grid">
              {cards.map((c) => (
                <ProductCard key={c.id} card={c} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="gg-pagination">
              <button
                className="gg-btn gg-btn-ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Previous
              </button>
              <span aria-live="polite">
                Page {page + 1} of {totalPages}
              </span>
              <button
                className="gg-btn gg-btn-ghost"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>

      {mobileFiltersOpen && (
        <>
          <div
            className="gg-drawer-overlay"
            onClick={() => setMobileFiltersOpen(false)}
            aria-hidden="true"
          />
          <div
            className="gg-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
          >
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
              <button
                className="gg-btn"
                style={{ width: "100%" }}
                onClick={() => setMobileFiltersOpen(false)}
              >
                Show {total} result{total === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
