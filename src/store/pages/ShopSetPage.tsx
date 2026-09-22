import { useEffect, useState } from "react";
import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { supabase, isSupabaseConfigured } from "../../supabase";
import {
  useCatalog,
  DEFAULT_FILTERS,
  PAGE_SIZE,
  type CatalogSort,
} from "../lib/useCatalog";
import ProductCard from "../components/ProductCard";

const SORTS: { value: CatalogSort; label: string }[] = [
  { value: "name_asc", label: "Name A → Z" },
  { value: "name_desc", label: "Name Z → A" },
  { value: "price_asc", label: "Price low → high" },
  { value: "price_desc", label: "Price high → low" },
];

type SetRow = { set_code: string; set_name: string; card_count: number };

// One page per set Geega stocks (e.g. /shop/set/ltr for The Lord of the
// Rings). Deliberately lean compared to ShopPage: the set is already fixed
// by the URL, so there's no filter sidebar to duplicate -- just sort +
// grid + pagination.
export default function ShopSetPage({ code }: { code: string }) {
  const [setInfo, setSetInfo] = useState<SetRow | null | undefined>(undefined);
  const [sort, setSort] = useState<CatalogSort>("name_asc");
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSetInfo(null);
      return;
    }
    let active = true;
    supabase
      .rpc("shop_sets_with_counts")
      .then(({ data }) => {
        if (!active) return;
        const rows = (data ?? []) as SetRow[];
        setSetInfo(rows.find((r) => r.set_code.toLowerCase() === code.toLowerCase()) ?? null);
      });
    return () => {
      active = false;
    };
  }, [code]);

  const filters = { ...DEFAULT_FILTERS, sets: [code.toUpperCase()], sort };
  const { cards, total, loading, error } = useCatalog(filters, page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    setPage(0);
  }, [code, sort]);

  const setName = setInfo?.set_name ?? code.toUpperCase();

  useSEO({
    title:
      setInfo === undefined
        ? "Loading… | Geega Games"
        : `Buy ${setName} Singles — Magic: The Gathering | Geega Games`,
    description: `Shop in-stock Magic: The Gathering singles from ${setName} at Geega Games. Honest condition grading, secure checkout, and fast shipping nationwide.`,
    path: `/shop/set/${code.toLowerCase()}`,
    noIndex: setInfo === null,
  });

  if (setInfo === null) {
    return (
      <div className="gg-page gg-empty">
        <h1>Set not found</h1>
        <p>We don&rsquo;t have any cards from that set in stock right now.</p>
        <Link to="/shop/sets" className="gg-btn">
          Browse all sets
        </Link>
      </div>
    );
  }

  return (
    <div className="gg-page">
      <nav className="gg-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/shop/sets">Shop by set</Link> <span aria-hidden="true">/</span>{" "}
        <span>{setName}</span>
      </nav>
      <h1 style={{ color: "var(--gg-ink)" }}>{setName}</h1>

      <div className="gg-toolbar">
        <p className="gg-card-meta" role="status" aria-live="polite" style={{ margin: 0 }}>
          {loading ? "Loading…" : `${total} result${total === 1 ? "" : "s"}`}
        </p>
        <label>
          <span className="visually-hidden">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as CatalogSort)}>
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

      {!loading && cards.length === 0 && !error ? (
        <div className="gg-empty">
          <p>No cards from {setName} are in stock right now.</p>
          <Link to="/shop/sets" className="gg-btn gg-btn-ghost">
            Browse other sets
          </Link>
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
  );
}
