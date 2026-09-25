import { useEffect, useRef, useState } from "react";
import { authLinkWithReturn } from "../lib/authRedirect";
import { Link } from "../lib/router";
import { useAuth } from "../lib/AuthContext";
import { useWishlist } from "../lib/WishlistContext";
import { Icon } from "./Icon";

// Heart/save toggle shared by ProductCard and CardDetailPage. On ProductCard
// it sits inside the image's own <Link>, so its click must stop propagation
// or it would also trigger the card's navigation.
export default function WishlistButton({
  oracleId,
  cardName,
}: {
  oracleId: string | null;
  cardName: string;
}) {
  const { user } = useAuth();
  const { isWishlisted, pending, toggle } = useWishlist();
  const [showPrompt, setShowPrompt] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPrompt) return;
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowPrompt(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [showPrompt]);

  // Nothing to key a save on. Shouldn't happen for a real listing, but a
  // missing oracle_id must never crash the card it sits on.
  if (!oracleId) return null;

  const saved = isWishlisted(oracleId);
  const busy = pending.has(oracleId);

  return (
    <div className="gg-wishlist-btn-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`gg-wishlist-btn${saved ? " gg-wishlist-btn--active" : ""}`}
        aria-pressed={saved}
        aria-label={
          saved ? `Remove ${cardName} from your wishlist` : `Save ${cardName} to your wishlist`
        }
        title={saved ? "Remove from wishlist" : "Save to wishlist"}
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!user) {
            setShowPrompt(true);
            return;
          }
          void toggle(oracleId, cardName);
        }}
      >
        <Icon name="heart" filled={saved} />
      </button>
      {showPrompt && (
        <div
          className="gg-wishlist-prompt"
          role="dialog"
          aria-label="Sign in to save cards"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <p>Sign in to save cards to your wishlist.</p>
          <Link to={authLinkWithReturn("/login")} className="gg-btn gg-btn-sm">
            Sign in
          </Link>
          <p className="gg-wishlist-prompt-alt">
            New here? <Link to={authLinkWithReturn("/signup")}>Create a free account</Link>
          </p>
        </div>
      )}
    </div>
  );
}
