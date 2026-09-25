import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { isStaffDevice } from "../lib/pageViews";
import { authLinkWithReturn } from "../lib/authRedirect";
import { Link, useRouter } from "../lib/router";
import { AccountPerksList } from "./AccountPerks";
import { Icon } from "./Icon";

// A small, dismissible "create a free account" card for signed-out visitors
// who are clearly browsing (a few pages in), never on first landing. It is a
// corner card, not a modal: it doesn't block the page, steal focus, or
// reappear for a month once closed.

const VIEWS_KEY = "gg_nudge_views";
const DISMISSED_KEY = "gg_nudge_dismissed_at";
const SHOW_AFTER_VIEWS = 3;
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

// Places where it would get in the way or make no sense.
function isExcluded(path: string): boolean {
  return (
    path === "/login" ||
    path === "/signup" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path === "/checkout" ||
    path === "/sell/offer" ||
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

/** Count page views for this browsing session; returns the new total. */
function bumpViews(): number {
  try {
    const n = (Number(sessionStorage.getItem(VIEWS_KEY)) || 0) + 1;
    sessionStorage.setItem(VIEWS_KEY, String(n));
    return n;
  } catch {
    return 0; // storage blocked — never show rather than show every page
  }
}

export default function SignupNudge() {
  const { user, loading } = useAuth();
  const { path } = useRouter();
  const [views, setViews] = useState(0);
  const [closed, setClosed] = useState(false);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    setViews(bumpViews());
  }, [path]);

  const visible =
    !loading &&
    !user &&
    !closed &&
    views >= SHOW_AFTER_VIEWS &&
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
      <h2 id="gg-nudge-title">Make it yours — free account</h2>
      <p className="gg-nudge-sub">Wishlists, deck restock alerts, order tracking and faster checkout.</p>
      <AccountPerksList compact />
      <div className="gg-nudge-actions">
        <Link
          to={authLinkWithReturn("/signup")}
          className="gg-btn gg-btn-sm"
          // Signing up is a yes — don't pester them again on the way back.
          onClick={rememberDismissed}
        >
          Create account
        </Link>
        <Link to={authLinkWithReturn("/login")} className="gg-nudge-signin" onClick={rememberDismissed}>
          Sign in
        </Link>
      </div>
    </aside>
  );
}
