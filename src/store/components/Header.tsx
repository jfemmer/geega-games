import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "../lib/router";
import { useCart } from "../lib/CartContext";
import { useAuth } from "../lib/AuthContext";
import { supabase } from "../../supabase";
import CartDrawer from "./CartDrawer";
import { Icon } from "./Icon";
import ShopByDeck from "./ShopByDeck";
import StorewideSaleBanner from "./StorewideSaleBanner";

const SUGGEST_DEBOUNCE_MS = 200;

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

  // Type-ahead suggestions are a separate concern from the URL-write
  // debounce above: this one only drives a local dropdown and never
  // navigates on its own, until a suggestion is actually chosen.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const suggestDebounceRef = useRef<number | undefined>(undefined);
  const suggestReqIdRef = useRef(0);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = searchInput.trim();
    window.clearTimeout(suggestDebounceRef.current);
    if (term.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    suggestDebounceRef.current = window.setTimeout(async () => {
      // Guard against a slower earlier request resolving after a faster
      // later one and clobbering it with stale results.
      const reqId = ++suggestReqIdRef.current;
      const { data, error } = await supabase.rpc("shop_card_name_suggestions", {
        p_query: term,
      });
      if (reqId !== suggestReqIdRef.current) return;
      if (error) {
        console.error("[Header] suggestion fetch failed", error);
        return;
      }
      const rows = (data as { card_name: string }[] | null) ?? [];
      setSuggestions(rows.map((row) => row.card_name));
      setHighlightIndex(-1);
      setShowSuggestions(rows.length > 0);
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(suggestDebounceRef.current);
  }, [searchInput]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const selectSuggestion = (name: string) => {
    // A chosen suggestion is an immediate, direct navigation — cancel both
    // debounces so a stale timer can't fire afterward and stomp on it.
    window.clearTimeout(debounceRef.current);
    window.clearTimeout(suggestDebounceRef.current);
    setSearchInput(name);
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightIndex(-1);
    const onShop = window.location.pathname === "/shop";
    const params = new URLSearchParams(onShop ? window.location.search : "");
    params.set("q", name);
    navigate(`/shop?${params.toString()}`, { replace: onShop });
  };

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
          {/* Own wrapper (distinct from ShopByDeck below) so the dropdown
              only spans the input and an outside click on the deck-shop
              button correctly closes it instead of being treated as
              "inside" the search box. */}
          <div className="gg-search-box" ref={searchBoxRef}>
            <label htmlFor="gg-search" className="visually-hidden">
              Search cards
            </label>
            <input
              id="gg-search"
              type="search"
              placeholder="Search singles…"
              value={searchInput}
              onChange={(e) => handleChange(e.target.value)}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (!showSuggestions || suggestions.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlightIndex((i) => (i + 1) % suggestions.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlightIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                } else if (e.key === "Enter") {
                  if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
                    e.preventDefault();
                    selectSuggestion(suggestions[highlightIndex]);
                  }
                } else if (e.key === "Escape") {
                  setShowSuggestions(false);
                  setHighlightIndex(-1);
                }
              }}
              autoComplete="off"
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls="gg-search-suggestions"
              aria-autocomplete="list"
              aria-activedescendant={
                highlightIndex >= 0 ? `gg-suggestion-${highlightIndex}` : undefined
              }
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul
                id="gg-search-suggestions"
                className="gg-search-suggestions"
                role="listbox"
                aria-label="Card suggestions"
              >
                {suggestions.map((name, i) => (
                  <li
                    key={name}
                    id={`gg-suggestion-${i}`}
                    role="option"
                    aria-selected={i === highlightIndex}
                    className={
                      i === highlightIndex
                        ? "gg-search-suggestion gg-search-suggestion--active"
                        : "gg-search-suggestion"
                    }
                    onMouseDown={(e) => {
                      // mousedown (not click) fires before the input's blur, so
                      // the outside-click handler above can't close this first.
                      e.preventDefault();
                      selectSuggestion(name);
                    }}
                    onMouseEnter={() => setHighlightIndex(i)}
                  >
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ShopByDeck />
        </div>

        <div className="gg-header-actions">
          <Link
            to={user ? "/account" : "/login"}
            className="gg-iconbtn gg-iconbtn--icon"
            aria-label={user ? "Account" : "Sign in"}
            title={user ? "Account" : "Sign in"}
          >
            <Icon name="user" />
            <span className="gg-iconbtn-label">{user ? "Account" : "Sign in"}</span>
          </Link>
          <button
            className="gg-iconbtn gg-iconbtn--icon gg-cartbtn"
            onClick={() => setCartOpen(true)}
            aria-label={`Open cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            title="Cart"
          >
            <Icon name="cart" />
            <span className="gg-iconbtn-label">Cart</span>
            {itemCount > 0 && (
              <span className="gg-cart-count">{itemCount}</span>
            )}
          </button>
          {user && (
            <button
              className="gg-iconbtn gg-iconbtn--icon"
              aria-label="Sign out"
              title="Sign out"
              onClick={async () => {
                await signOut();
                navigate("/");
              }}
            >
              <Icon name="logout" />
              <span className="gg-iconbtn-label">Sign out</span>
            </button>
          )}
        </div>
      </div>

      <StorewideSaleBanner />

      <nav className="gg-nav" aria-label="Primary">
        <Link to="/shop">Shop singles</Link>
        <Link to="/shop/sets">Shop by set</Link>
        <Link to="/shop?sort=newest">New arrivals</Link>
        <Link to="/shop?deals=1" className="gg-nav-deals">
          Deals & Specials
        </Link>
        <Link to="/sell-my-collection" className="gg-nav-sell">
          Sell Your Cards
        </Link>
      </nav>

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </header>
  );
}
