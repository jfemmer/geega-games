import { useState } from "react";
import { Link } from "../lib/router";
import { useAuth } from "../lib/AuthContext";
import { useSEO } from "../lib/useSEO";
import { formatCents } from "../lib/money";
import { SUPPORT_EMAIL } from "../lib/supportEmail";
import { FaqSection } from "../components/SellLandingSections";
import { HowTradingWorks } from "../components/trades/HowTradingWorks";
import { UseMyCardsPanel } from "../components/trades/UseMyCards";
import { useTradeTerms } from "../lib/tradeCenterApi";
import { MY_TRADES_PATH, TRADE_CENTER_PATH, termsForHandoff, type TradeHandoffMethod, type TradeTerms } from "../lib/tradeCenter";
import { depositBands } from "../lib/tradeRules";
import { moneyShort } from "../lib/tradeShipping";
import { ourShipping, tradeFaqItems } from "../lib/tradeFaq";
import { breadcrumbJsonLd, faqJsonLd } from "../../seo/site";

// Trade Cards (/trade-cards): trading toward the cards in the shopping
// cart. The same "Use My Magic Cards" panel as checkout (UseMyCards.tsx):
// the cart's cards at their trade prices, the minimum, and starting the
// trade. Beside it, how trading works in three steps, the rules worth
// knowing, the deposit, and the FAQ. Every number comes from the Trade
// Center settings staff control, so the page can't promise anything the
// trade itself won't do. There is no separate trade cart any more: customers
// add cards to the normal cart and choose how to pay at checkout.

export default function TradeCardsPage() {
  const terms = useTradeTerms();
  const { user } = useAuth();
  const [handoff, setHandoff] = useState<TradeHandoffMethod>("ship");
  const faq = tradeFaqItems(terms);
  // Local pickup only while it's offered; a choice made before it was turned off falls back to shipping.
  const method: TradeHandoffMethod = handoff === "local" && terms?.localPickupEnabled ? "local" : "ship";
  // The terms for the way they've chosen (local pickup can have its own rate and minimums).
  const active = terms ? termsForHandoff(terms, method) : null;

  useSEO({
    title: "Trade Your Magic Cards Toward Cards You Want | Geega Games",
    description:
      "Shop Magic singles at Geega Games and trade the cards you're not using toward them. Eligible cards earn trade credit at TCG low; we hold your chosen cards while we review your trade.",
    path: TRADE_CENTER_PATH,
    jsonLd: [breadcrumbJsonLd([{ name: "Trade cards", path: TRADE_CENTER_PATH }]), faqJsonLd(faq)],
  });

  return (
    <div className="gg-page gg-tc-page gg-tc-cartpage">
      <header className="gg-tc-cartpage__head">
        <div>
          <h1>Trade your cards toward your cart</h1>
          <p className="gg-tc-cartpage__lead">
            Shop as usual, then trade the Magic cards you&rsquo;re not using toward the ones in your cart. We price your cards at TCG
            low, and you get {active ? `${active.creditRatePercent}%` : "a share"} of that as trade credit.
          </p>
          {active && (
            <p className="gg-tc-staples">
              <strong>We&rsquo;re looking for staples:</strong> cards worth <strong>{moneyShort(active.minCardValueCents)}+</strong> each
              at TCG low, in their condition. No bulk, please.
            </p>
          )}
        </div>
        {user && (
          <Link to={MY_TRADES_PATH} className="gg-tc-cartpage__mine">
            Your trades
          </Link>
        )}
      </header>

      <div className="gg-tc-cartpage__grid">
        <div className="gg-tc-cartpage__items" id="trade-cart">
          <UseMyCardsPanel handoff={method} onHandoffChange={setHandoff} />
        </div>
        <div className="gg-tc-cartpage__info">
          {/* Opens on the way they've chosen in the panel (remounts when that changes). */}
          <HowTradingWorks key={method} terms={terms} initial={method} />
          <GoodToKnow terms={terms} />
        </div>
      </div>

      <FaqSection items={faq} />
      <p className="gg-collect-contact">
        Questions about a trade? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </div>
  );
}

/** The rules worth knowing before starting, short; the deposit's table opens on demand. */
function GoodToKnow({ terms }: { terms: TradeTerms | null }) {
  return (
    <section className="gg-tc-know" aria-labelledby="gg-tc-know-title">
      <h2 id="gg-tc-know-title">Good to know</h2>
      <ul className="gg-tc-know__list">
        {terms && (
          <li>
            We&rsquo;re looking for staples: cards worth less than <strong>{moneyShort(terms.minCardValueCents)}</strong> each at TCG
            low, in their condition, can&rsquo;t be traded.
          </li>
        )}
        <li>Our cards count at their regular price. Sale and member prices don&rsquo;t apply to trades.</li>
        <li>{ourShipping(terms)} Paid by card when your trade is final, never out of your trade credit.</li>
        <li>You ship your cards to us separately, with tracking, at your cost. We&rsquo;ll show you how to pack them.</li>
        <li>Shipping is never charged on a trade that&rsquo;s canceled or declined, and it&rsquo;s separate from any deposit.</li>
        {terms && terms.processingFeeCents > 0 && (
          <li>A processing fee of {formatCents(terms.processingFeeCents)} comes off each trade&rsquo;s credit.</li>
        )}
      </ul>
      {terms?.depositsEnabled && <DepositDetails terms={terms} />}
    </section>
  );
}

/** The refundable deposit: when it's needed, how much, and exactly when it comes back. */
function DepositDetails({ terms }: { terms: TradeTerms }) {
  const threshold = terms.depositThresholdCents;
  const bands = depositBands(terms);
  return (
    <details className="gg-tc-know__deposit">
      <summary>The refundable deposit</summary>
      <p>
        Confirming a trade reserves our cards for you until it&rsquo;s done, so trades with {formatCents(threshold)} or more of our
        cards need a small deposit to confirm. It comes back in full as soon as the carrier accepts your package by your shipping deadline.
      </p>
      <table className="gg-tc-table gg-tc-valuetable">
        <caption>The deposit, by the value of our cards on your trade</caption>
        <thead>
          <tr>
            <th scope="col">Our cards</th>
            <th scope="col">Deposit</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => {
            const onlyIfAsked = b.toCents !== null && b.toCents <= threshold;
            return (
              <tr key={b.fromCents}>
                <th scope="row">
                  {b.toCents === null
                    ? `${formatCents(b.fromCents)} or more`
                    : b.fromCents === 0
                      ? `Under ${formatCents(b.toCents)}`
                      : `${formatCents(b.fromCents)} to ${formatCents(b.toCents - 1)}`}
                </th>
                <td>
                  {formatCents(b.depositCents)}
                  {onlyIfAsked && <span className="gg-tc-valuetable__note"> only if we ask</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul>
        <li>Refunded in full, to the card you paid with. The card processing fee is on us.</li>
        <li>Declining our final offer after your cards arrive, or canceling once the carrier has your package, never costs it.</li>
        <li>
          If you cancel after confirming and before shipping, or don&rsquo;t ship by your deadline, it may be kept under our cancellation
          policy. A person reviews every case first.
        </li>
        <li>
          We may ask for a deposit on a smaller trade, for example after earlier trades were canceled after confirming or not shipped in
          time. You&rsquo;ll always see it before you confirm.
        </li>
        <li>If a card sells while your deposit is going through, nothing is reserved and the deposit is refunded in full.</li>
      </ul>
    </details>
  );
}
