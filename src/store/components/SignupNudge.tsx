import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { useCart } from "../lib/CartContext";
import { isStaffDevice } from "../lib/pageViews";
import { authLinkWithReturn } from "../lib/authRedirect";
import { Link, useRouter } from "../lib/router";
import { MEMBER_DISCOUNT_PERCENT, formatCents, memberDiscountCents } from "../lib/money";
import { Icon } from "./Icon";

// The "create a free account" card for signed-out shoppers. It appears at the
// moment an account is worth the most to them: right after they put a card
// in their cart, when signing in would take MEMBER_DISCOUNT_PERCENT off that
// very order (checkout carries its own, in-page version of the same offer).
// It is a corner card, not a modal: it doesn't block the page or steal focus,
// and once closed it stays away for a month.

const DISMISSED_KEY = "gg_nudge_dismissed_at";
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

// Places where it would get in the way or make no sense. Checkout has its
// own offer in the page.
function isExcluded(path: string): boolean {
  return (
    path === "/login" ||
    path === "/signup" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path === "/checkout" ||
    path === "/sell/offer" ||
    path === "/kiosk" ||
    path === "/account" ||
    path.startsWith("/account/")
  );
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    /* storage blocked — it just won't be remembered past this page */
  }
}

/**
 * True once a card has been added to the cart since the page loaded. The
 * cart's first load (a returning shopper's saved cart) doesn't count — only
 * an add does.
 */
function useAddedToCart(): boolean {
  const { itemCount, loading } = useCart();
  const before = useRef<number | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (before.current !== null && itemCount > before.current) setAdded(true);
    before.current = itemCount;
  }, [itemCount, loading]);

  return added;
}

export default function SignupNudge() {
  const { user, loading } = useAuth();
  const { path } = useRouter();
  const { subtotalCents } = useCart();
  const added = useAddedToCart();
  const [closed, setClosed] = useState(false);
  const savingsCents = memberDiscountCents(subtotalCents);

  const visible =
    !loading &&
    !user &&
    !closed &&
    added &&
    savingsCents > 0 &&
    !isExcluded(path) &&
    !recentlyDismissed() &&
    !isStaffDevice();

  if (!visible) return null;

  const dismiss = () => {
    rememberDismissed();
    setClosed(true);
  };

  return (
    <aside className="gg-nudge" aria-labelledby="gg-nudge-title">
      <button
        type="button"
        className="gg-nudge-close"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={dismiss}
      >
        <Icon name="close" size={18} />
      </button>
      <p className="gg-nudge-kicker">Added to your cart</p>
      <h2 id="gg-nudge-title">Save {formatCents(savingsCents)} on this order</h2>
      <p className="gg-nudge-sub">
        Create a free account or sign in before you check out: your cards are{" "}
        {MEMBER_DISCOUNT_PERCENT}% off, on this order and every one after. Your cart comes with you.
      </p>
      <div className="gg-nudge-actions">
        <Link
          to={authLinkWithReturn("/signup")}
          className="gg-btn gg-btn-sm"
          // Signing up is a yes — don't pester them again on the way back.
          onClick={rememberDismissed}
        >
          Create free account
        </Link>
        <Link to={authLinkWithReturn("/login")} className="gg-nudge-signin" onClick={rememberDismissed}>
          Sign in
        </Link>
      </div>
    </aside>
  );
}
