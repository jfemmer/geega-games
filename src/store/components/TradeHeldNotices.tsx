import { Link } from "../lib/router";
import { useCart } from "../lib/CartContext";
import { cardDetailPath } from "../lib/cardSlug";
import { heldCopyLabel } from "../lib/tradeHolds";
import TradeHoldNotify from "./TradeHoldNotify";

/**
 * Cart lines that came out (or were cut down) because a trade is holding
 * those copies: what happened, and "Notify me if it's released". Shown in
 * the cart drawer and at checkout.
 */
export default function TradeHeldNotices({ onNavigate }: { onNavigate?: () => void }) {
  const { tradeHeld, dismissTradeHeld } = useCart();
  if (!tradeHeld.length) return null;
  return (
    <div className="gg-tradehold-notices" role="status">
      {tradeHeld.map((c) => (
        <div key={c.id} className="gg-alert gg-alert-warn gg-tradehold-notice">
          <button
            type="button"
            className="gg-tradehold-notice__close"
            aria-label={`Dismiss the note about ${c.cardName}`}
            onClick={() => dismissTradeHeld(c.id)}
          >
            ✕
          </button>
          <p className="gg-tradehold-notice__text">
            <strong>
              <Link to={cardDetailPath(c.cardName)} onClick={onNavigate}>
                {c.cardName}
              </Link>
            </strong>{" "}
            <span className="gg-card-meta">({heldCopyLabel(c)})</span>{" "}
            {c.sellableQuantity > 0
              ? "is partly on hold for a pending trade, so your cart now has only what’s left."
              : "is on hold for a pending trade, so we took it out of your cart. If the trade doesn’t go ahead, it goes back on sale."}
          </p>
          {c.sellableQuantity === 0 && <TradeHoldNotify inventoryItemId={c.id} cardName={c.cardName} />}
        </div>
      ))}
    </div>
  );
}
