import { useState } from "react";
import { Link, useRouter } from "../lib/router";
import { useCart } from "../lib/CartContext";
import { useAuth } from "../lib/AuthContext";
import CartDrawer from "./CartDrawer";

export default function Header({
  search,
  onSearch,
}: {
  search?: string;
  onSearch?: (v: string) => void;
}) {
  const { itemCount } = useCart();
  const { user, signOut } = useAuth();
  const { navigate } = useRouter();
  const [cartOpen, setCartOpen] = useState(false);

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
            value={search ?? ""}
            onChange={(e) => {
              if (onSearch) {
                onSearch(e.target.value);
              } else {
                navigate(
                  `/shop?q=${encodeURIComponent(e.target.value)}`,
                );
              }
            }}
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
