import { useEffect, useMemo, useState } from "react";
import { useRouter } from "../lib/router";
import {
  useCatalog,
  useFacets,
  DEFAULT_FILTERS,
  PAGE_SIZE,
  type CatalogFilters,
  type CatalogSort,
} from "../lib/useCatalog";
import ProductCard from "../components/ProductCard";

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
const SORTS: { value: CatalogSort; label: string }[] = [
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
  { value: "price_asc", label: "Price low → high" },
  { value: "price_desc", label: "Price high → low" },
  { value: "newest", label: "Newest" },
];

export default function ShopPage() {
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
    filters.minPriceCents,
    filters.maxPriceCents,
    filters.dealsOnly,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggle = (key: "sets" | "rarities" | "conditions", value: string) => {
    setFilters((f) => {
      const arr = f[key];
      return {
        ...f,
        [key]: arr.includes(value)
          ? arr.filter((v) => v !== value)
          : [...arr, value],
      };
    });
  };

  const activeFilterCount =
    filters.sets.length +
    filters.rarities.length +
    filters.conditions.length +
    (filters.minPriceCents != null ? 1 : 0) +
    (filters.maxPriceCents != null ? 1 : 0);

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
          <button
            className="gg-btn gg-btn-ghost gg-btn-sm"
            onClick={() => setFilters(DEFAULT_FILTERS)}
          >
            Clear filters ({activeFilterCount})
          </button>
        )}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facets, filters.sets, filters.rarities, filters.conditions, activeFilterCount],
  );

  return (
    <div className="gg-page">
      {filters.dealsOnly && (
        <section className="gg-deals-hero" aria-labelledby="gg-deals-title">
          <div>
            <span className="gg-deals-kicker">Deals & Specials</span>
            <h1 id="gg-deals-title">Save on singles</h1>
            <p>
              Hand-picked specials plus cards automatically marked down after
              they’ve been in stock for 30 days.
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
