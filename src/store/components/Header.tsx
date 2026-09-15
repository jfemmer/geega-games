import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "../lib/router";
import { useCart } from "../lib/CartContext";
import { useAuth } from "../lib/AuthContext";
import CartDrawer from "./CartDrawer";

// Debounce before we write a keystroke into the URL. This is independent of
// useCatalog's own 300ms fetch debounce (which fires off filters.query) — the
// two are allowed to stack slightly; what matters is neither fires per key.
const SEARCH_URL_DEBOUNCE_MS = 250;

export default function Header() {
  const { itemCount } = useCart();
  const { user, signOut } = useAuth();
  const { path, query, navigate } = useRouter();
  const [cartOpen, setCartOpen] = useState(false);

  // The input is the single interactive source of truth for what's displayed
  // while typing; it's initialized from and kept in sync with the URL so
  // back/forward, nav links, and a bookmarked/shared search link all reflect
  // correctly into the box. `urlSearchValue` is compared against the PREVIOUS
  // url-derived value (not against `searchInput`) so a still-in-flight
  // keystroke never gets clobbered by the URL not having caught up to it yet.
  // This is React's documented "adjust state during render" pattern rather
  // than an Effect, since it's deriving state from a prop change, not
  // synchronizing with an external system. https://react.dev/learn/you-might-not-need-an-effect
  const urlSearchValue = path === "/shop" ? (query.get("q") ?? "") : "";
  const [searchInput, setSearchInput] = useState(urlSearchValue);
  const [lastUrlSearchValue, setLastUrlSearchValue] = useState(urlSearchValue);
  if (urlSearchValue !== lastUrlSearchValue) {
    setLastUrlSearchValue(urlSearchValue);
    setSearchInput(urlSearchValue);
  }

  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Any externally-driven URL change (nav link, browser back/forward, a
    // bookmarked search link) wins over a keystroke commit still in flight —
    // e.g. hitting Back within the debounce window must not have that timer
    // fire afterward and shove the user right back to /shop. Clearing a
    // pending timer is a real side effect (unlike the state sync above), so
    // it belongs in an Effect.
    window.clearTimeout(debounceRef.current);
  }, [urlSearchValue]);

  useEffect(() => {
    return () => window.clearTimeout(debounceRef.current);
  }, []);

  const handleChange = (value: string) => {
    setSearchInput(value);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      // Read the live URL at fire time (not a closed-over value) since the
      // debounce can outlive the render that scheduled it.
      const onShop = window.location.pathname === "/shop";
      const params = new URLSearchParams(
        onShop ? window.location.search : "",
      );
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      const qs = params.toString();
      // Landing on /shop from elsewhere is a real navigation (back should
      // return you to where you were); once there, further keystrokes
      // replace the entry so typing never spams browser history.
      navigate(qs ? `/shop?${qs}` : "/shop", { replace: onShop });
    }, SEARCH_URL_DEBOUNCE_MS);
  };

  return (
    <header className="gg-header">
      <div className="gg-header-row">
        <Link to="/" aria-label="Geega Games home">
          <img className="gg-logo" src="/logo.png" alt="Geega Games" />
        </Link>

        <div className="gg-header-search">
          <label htmlFor="gg-search" className="visually-hidden">
            Search cards
          </label>
          <input
            id="gg-search"
            type="search"
            placeholder="Search singles…"
            value={searchInput}
            onChange={(e) => handleChange(e.target.value)}
          />
        </div>

        <div className="gg-header-actions">
          {user ? (
            <>
              <Link to="/account" className="gg-iconbtn">
                Account
              </Link>
              <button
                className="gg-iconbtn"
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link to="/login" className="gg-iconbtn">
              Sign in
            </Link>
          )}
          <button
            className="gg-iconbtn"
            onClick={() => setCartOpen(true)}
            aria-label={`Open cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
          >
            Cart
            {itemCount > 0 && (
              <span className="gg-cart-count">{itemCount}</span>
            )}
          </button>
        </div>
      </div>

      <nav className="gg-nav" aria-label="Primary">
        <Link to="/shop">Shop singles</Link>
        <Link to="/shop?sort=newest">New arrivals</Link>
        <Link to="/condition-guide">Condition guide</Link>
        <Link to="/shipping">Shipping</Link>
        <Link to="/returns">Returns</Link>
      </nav>

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </header>
  );
}
