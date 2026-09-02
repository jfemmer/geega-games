import { useEffect, useMemo, useState } from "react";
import "./App.css";
import CardGrid from "./CardGrid";
import Menu from "./Menu";
import Footer from "./Footer";
import SignupForm from "./SignupForm";
import { fetchCards, type Card } from "./cards";

type Sort = "" | "name-asc" | "name-desc" | "price-asc" | "price-desc";

export default function App() {
  const [allCards, setAllCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<Sort>("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const data = await fetchCards();
        if (active) setAllCards(data);
      } catch (err) {
        if (active) {
          setLoadError(
            err instanceof Error ? err.message : "Could not load the catalog.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const types = useMemo(
    () =>
      Array.from(
        new Set(allCards.map((c) => c.type).filter((t): t is string => !!t)),
      ).sort(),
    [allCards],
  );

  const visible = useMemo(() => {
    let out = allCards.filter((c) => {
      const matchesQuery = c.name
        .toLowerCase()
        .includes(query.trim().toLowerCase());
      const matchesType = !type || c.type === type;
      return matchesQuery && matchesType;
    });
    switch (sort) {
      case "name-asc":
        out = [...out].sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        out = [...out].sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "price-asc":
        out = [...out].sort((a, b) => a.price_usd - b.price_usd);
        break;
      case "price-desc":
        out = [...out].sort((a, b) => b.price_usd - a.price_usd);
        break;
    }
    return out;
  }, [allCards, query, type, sort]);

  return (
    <div className="app">
      <a className="skip-link" href="#catalog">
        Skip to catalog
      </a>

      <div className="ribbon">
        <span className="ribbon-dot" aria-hidden="true" />
        Browsing is open &mdash; checkout and payment processing go live soon.
      </div>

      <header className="masthead">
        <div className="masthead-row">
          <img
            className="brand"
            src="/logo.png"
            alt="Geega Games"
            width={220}
            height={194}
          />
          <div className="masthead-actions">
            <button className="pill" disabled title="Cart opens at launch">
              Cart (0) &middot; soon
            </button>
            <button className="pill" disabled title="Accounts open at launch">
              Sign in &middot; soon
            </button>
          </div>
        </div>
        <div className="search">
          <label htmlFor="search-input" className="visually-hidden">
            Search cards
          </label>
          <input
            id="search-input"
            type="search"
            placeholder="Search for a card&hellip;"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <nav className="subnav">
        <div className="subnav-left">
          <Menu />
          <button
            className="filter-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-expanded={sidebarOpen}
          >
            &#9906; Filters
          </button>
        </div>
        <div className="sort-wrap">
          <label htmlFor="sort-select" className="visually-hidden">
            Sort cards
          </label>
          <select
            id="sort-select"
            className="sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            <option value="">Sort by</option>
            <option value="name-asc">Name A &rarr; Z</option>
            <option value="name-desc">Name Z &rarr; A</option>
            <option value="price-asc">Price low &rarr; high</option>
            <option value="price-desc">Price high &rarr; low</option>
          </select>
        </div>
      </nav>

      <div className="layout">
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-head">
            <span>Filters</span>
            <button
              className="sidebar-close"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close filters"
            >
              &#10006;
            </button>
          </div>
          <div className="filter-group">
            <label htmlFor="f-type">Card type</label>
            <select
              id="f-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {(type || query) && (
            <button
              className="clear-filters"
              onClick={() => {
                setType("");
                setQuery("");
              }}
            >
              Clear all
            </button>
          )}
        </aside>

        <main className="content" id="catalog">
          {loading && (
            <div className="card-grid" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div className="card card-skeleton" key={i}>
                  <div className="skeleton-art" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                </div>
              ))}
            </div>
          )}
          {loading && (
            <p className="result-count" role="status">
              Loading catalog&hellip;
            </p>
          )}

          {loadError && !loading && (
            <div className="empty" role="alert">
              <p>Couldn&rsquo;t load the catalog.</p>
              <span>{loadError}</span>
            </div>
          )}

          {!loading && !loadError && (
            <>
              <p className="result-count" role="status" aria-live="polite">
                {visible.length} card{visible.length === 1 ? "" : "s"}
              </p>
              <CardGrid cards={visible} />
            </>
          )}
        </main>
      </div>

      <section className="launch" id="launch">
        <div className="launch-inner">
          <SignupForm />
        </div>
      </section>

      <Footer />
    </div>
  );
}
