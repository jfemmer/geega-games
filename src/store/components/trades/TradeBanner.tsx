import { Link } from "../../lib/router";
import { useTradeTerms } from "../../lib/tradeCenterApi";
import { TRADE_IN_PATH, tradingOpen } from "../../lib/tradeCenter";
import { Icon } from "../Icon";

// One line on the shop pages so shoppers know they can trade: their cards
// toward the cards in their cart, at checkout. Shown only while trading is
// open (Trades → Settings); nothing to dismiss, and no decision to make while
// browsing: they choose how to pay at checkout.

export function TradeBanner() {
  const terms = useTradeTerms();
  if (!tradingOpen(terms)) return null;
  return (
    <p className="gg-trade-banner">
      <Icon name="swap" size={16} />
      <span>
        Have Magic cards you&rsquo;re not using? Trade them toward your cart at checkout
        {terms ? `: ${terms.creditRatePercent}% of their value in trade credit` : ""}.
      </span>{" "}
      <Link to={TRADE_IN_PATH}>How trading works</Link>
    </p>
  );
}
