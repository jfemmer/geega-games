import { useEffect, useMemo, useState } from "react";
import "./App.css";
import CardGrid from "./CardGrid";
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
  const [menuOpen, setMenuOpen] = useState(false);

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
            err instanceof Error ? err.message : "Could not load the catalog."
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
        new Set(allCards.map((c) => c.type).filter((t): t is string => !!t))
      ).sort(),
    [allCards]
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
      case "name-asc": out = [...out].sort((a, b) => a.name.localeCompare(b.name)); break;
      case "name-desc": out = [...out].sort((a, b) => b.name.localeCompare(a.name)); break;
      case "price-asc": out = [...out].sort((a, b) => a.price_usd - b.price_usd); break;
      case "price-desc": out = [...out].sort((a, b) => b.price_usd - a.price_usd); break;
    }
    return out;
  }, [allCards, query, type, sort]);

  return (
    <div className="app">
      <div className="ribbon">
        <span className="ribbon-dot" aria-hidden="true" />
        Browsing is open — checkout and payment processing go live soon.
      </div>

      <header className="masthead">
        <div className="masthead-row">
          <img className="brand" src="/logo.png" alt="Geega Games" width={220} height={194} />
          <div className="masthead-actions">
            <button className="pill" disabled title="Cart opens at launch">Cart (0)</button>
            <button className="pill" disabled title="Accounts open at launch">Sign in</button>
          </div>
        </div>
        <div className="search">
          <input
            type="search"
            placeholder="Search for a card…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search cards"
          />
        </div>
      </header>

      <nav className="subnav">
        <div className="subnav-left">
          <div className="menu">
            <button
              className="menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label="Menu"
            >
              ☰
            </button>
            {menuOpen && (
              <div className="menu-drop">
                <a href="#" onClick={(e) => e.preventDefault()}>Home</a>
                <a href="#" onClick={(e) => e.preventDefault()}>Request a card</a>
                <a href="#" onClick={(e) => e.preventDefault()}>Trade-in</a>
              </div>
            )}
          </div>
          <button className="filter-btn" onClick={() => setSidebarOpen((v) => !v)}>
            ⚲ Filters
          </button>
        </div>
        <select
          className="sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort cards"
        >
          <option value="">Sort by</option>
          <option value="name-asc">Name A → Z</option>
          <option value="name-desc">Name Z → A</option>
          <option value="price-asc">Price low → high</option>
          <option value="price-desc">Price high → low</option>
        </select>
      </nav>

      <div className="layout">
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-head">
            <span>Filters</span>
            <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close filters">✖</button>
          </div>
          <div className="filter-group">
            <label htmlFor="f-type">Card type</label>
            <select id="f-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {(type || query) && (
            <button
              className="clear-filters"
              onClick={() => { setType(""); setQuery(""); }}
            >
              Clear all
            </button>
          )}
        </aside>

        <main className="content">
          {loading && <p className="result-count">Loading catalog…</p>}

          {loadError && (
            <div className="empty">
              <p>Couldn’t load the catalog.</p>
              <span>{loadError}</span>
            </div>
          )}

          {!loading && !loadError && (
            <>
              <p className="result-count">
                {visible.length} card{visible.length === 1 ? "" : "s"}
              </p>
              <CardGrid cards={visible} />
            </>
          )}
        </main>
      </div>

      <footer className="footer">
        <span>© {new Date().getFullYear()} Geega Games</span>
        <span>Magic: The Gathering singles — opening soon</span>
      </footer>
    </div>
  );
}