import { Link } from "../../lib/router";
import { useTradeTerms } from "../../lib/tradeCenterApi";
import { tradeCartTotalCents, useTradeCart } from "../../lib/tradeCart";
import { TRADE_CENTER_PATH, tradingOpen } from "../../lib/tradeCenter";
import { TradeShippingProgress } from "./TradeShippingProgress";

// Where the trade cart stands while the customer shops: toward the trade
// minimum, then free shipping, with a link to the cart. Shown on card pages
// and above the shop's grids once trading is open and something's in the
// cart; nothing otherwise (and nothing in the prerendered page).

export function TradeCartProgress() {
  const terms = useTradeTerms();
  const totalCents = tradeCartTotalCents(useTradeCart());
  if (!terms || !tradingOpen(terms) || totalCents <= 0) return null;
  return (
    <TradeShippingProgress
      compact
      wantedCents={totalCents}
      terms={terms}
      action={
        <Link to={`${TRADE_CENTER_PATH}#trade-cart`} className="gg-tc-progress__link">
          Review your trade
        </Link>
      }
    />
  );
}
