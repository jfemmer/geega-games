import { useState } from "react";
import { Link, useRouter } from "../lib/router";
import { useAuth } from "../lib/AuthContext";
import { useSEO } from "../lib/useSEO";
import { formatCents } from "../lib/money";
import { authLinkWithReturn } from "../lib/authRedirect";
import { SUPPORT_EMAIL } from "./StaticPages";
import { FaqSection } from "../components/SellLandingSections";
import { TradeWantedList } from "../components/trades/TradeWantedList";
import { TradeShippingProgress } from "../components/trades/TradeShippingProgress";
import { HandoffChoice, LocalCartSummary } from "../components/trades/LocalPickup";
import { HowTradingWorks } from "../components/trades/HowTradingWorks";
import { tradeActions, useTradeTerms } from "../lib/tradeCenterApi";
import { tradeCart, tradeCartCount, tradeCartTotalCents, useTradeCart } from "../lib/tradeCart";
import {
  MY_TRADES_PATH,
  TRADE_CENTER_PATH,
  myTradePath,
  termsForHandoff,
  tradingOpen,
  type TradeHandoffMethod,
  type TradeTerms,
} from "../lib/tradeCenter";
import { depositBands } from "../lib/tradeRules";
import { minimumMessage, moneyShort, requiredValueCents, shippingLabel, tradeShippingCents } from "../lib/tradeShipping";
import { ourShipping, tradeFaqItems } from "../lib/tradeFaq";
import { breadcrumbJsonLd, faqJsonLd } from "../../seo/site";

// Trade Cards (/trade-cards): the trade cart. Our cards the customer picked
// with "Add to trade", with quantities and a way to take them off; beside
// them the summary a cart would have, plus what trading needs: how much of
// their cards, at TCG low, it takes to cover ours at the trade rate, the
// minimum and free shipping, and starting the trade. Under that, how
// trading works in a few short steps (we price their cards at TCG low when
// we review the list; conditions come from each card's age; we check them
// when the cards arrive, so values can go up or down), the rules worth
// knowing, the deposit, and the FAQ. Every number comes from the Trade
// Center settings staff control, so the page can't promise anything the
// trade itself won't do. When local pickup is on, the customer can choose to
// trade in person instead: no card list, no shipping, settled when we meet,
// on local pickup's own terms (its credit rate, per-card minimum, minimum
// trade and cash payouts can differ from shipping's): the cart shows the
// terms for the way the customer has chosen.

export default function TradeCardsPage() {
  const terms = useTradeTerms();
  const cart = useTradeCart();
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<TradeHandoffMethod>("ship");
  const faq = tradeFaqItems(terms);

  useSEO({
    title: "Trade Your Magic Cards for Cards You Want | Geega Games",
    description:
      "Trade your Magic: The Gathering cards for singles from Geega Games. We price your cards at TCG low and you get trade credit toward the cards you pick; once your trade is approved and confirmed, we reserve them for you.",
    path: TRADE_CENTER_PATH,
    jsonLd: [breadcrumbJsonLd([{ name: "Trade cards", path: TRADE_CENTER_PATH }]), faqJsonLd(faq)],
  });

  const open = tradingOpen(terms);
  const count = tradeCartCount(cart);
  const total = tradeCartTotalCents(cart);
  // Local pickup only while it's offered; a choice made before it was turned off falls back to shipping.
  const method: TradeHandoffMethod = handoff === "local" && terms?.localPickupEnabled ? "local" : "ship";
  // The terms for the way they've chosen (local pickup can have its own rate and minimums).
  const active = terms ? termsForHandoff(terms, method) : null;
  const belowMinimum = active !== null && total < active.minTradeValueCents;

  async function start() {
    if (belowMinimum) return;
    if (!user) {
      navigate(authLinkWithReturn("/login", TRADE_CENTER_PATH));
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await tradeActions.start(
        cart.map((c) => ({ inventoryItemId: c.inventoryItemId, quantity: c.quantity })),
        method,
      );
      tradeCart.clear();
      navigate(myTradePath(res.trade.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't start your trade. Try again.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="gg-page gg-tc-page gg-tc-cartpage">
      <header className="gg-tc-cartpage__head">
        <div>
          <h1>Your trade cart</h1>
          <p className="gg-tc-cartpage__lead">
            Trade your Magic cards for cards from our shop. We price your cards at TCG low, and you get{" "}
            {active ? `${active.creditRatePercent}%` : "a share"} of that as trade credit toward ours.
          </p>
          <p className="gg-tc-staples">
            <strong>We&rsquo;re looking for staples:</strong>{" "}
            {active ? (
              <>
                cards worth <strong>{moneyShort(active.minCardValueCents)}+</strong> each at TCG low, in their condition. No bulk, please.
              </>
            ) : (
              "cards with a solid TCG low, not bulk."
            )}
          </p>
        </div>
        {user && (
          <Link to={MY_TRADES_PATH} className="gg-tc-cartpage__mine">
            Your trades
          </Link>
        )}
      </header>
      {terms && !terms.enabled && (
        <p className="gg-tc-banner gg-tc-cartpage__banner">Trading online opens soon. Check back shortly, or email us about a trade.</p>
      )}
      {terms?.enabled && terms.paused && <p className="gg-tc-banner gg-tc-cartpage__banner">{terms.pauseMessage}</p>}

      <div className={count > 0 ? "gg-tc-cartpage__grid" : "gg-tc-cartpage__grid gg-tc-cartpage__grid--empty"}>
        <section className="gg-tc-cartpage__items" id="trade-cart" aria-labelledby="gg-tc-cart-title">
          {count === 0 ? (
            <div className="gg-tc-cartpage__empty">
              <h2 id="gg-tc-cart-title">Your trade cart is empty</h2>
              <p>
                Find cards you want in our shop and tap <strong>Add to trade</strong>. They wait here until you start your trade.
              </p>
              <Link to="/shop" className="gg-btn">
                Browse cards to trade for
              </Link>
            </div>
          ) : (
            <>
              <div className="gg-tc-cartpage__itemshead">
                <h2 id="gg-tc-cart-title">
                  Cards you want <span className="gg-tc-cartpage__count">({count})</span>
                </h2>
                <Link to="/shop" className="gg-tc-cartpage__more">
                  Add more cards
                </Link>
              </div>
              <TradeWantedList
                rows={cart.map((c) => ({
                  key: c.inventoryItemId,
                  cardName: c.cardName,
                  setCode: c.setCode,
                  setName: c.setName,
                  collectorNumber: c.collectorNumber,
                  condition: c.condition,
                  finish: c.finish,
                  imageUrl: c.imageUrl,
                  quantity: c.quantity,
                  unitPriceCents: c.tradePriceCents,
                  maxQuantity: c.maxQuantity,
                  cardPath: c.cardPath,
                }))}
                onQuantity={(key, quantity) => tradeCart.setQuantity(key, quantity)}
                onRemove={(key) => tradeCart.remove(key)}
              />
              <p className="gg-tc-line__meta gg-tc-cartpage__note">
                Trade prices are our regular prices (sale prices don&rsquo;t apply to trades). We check each card is still available
                when you start.
              </p>
            </>
          )}
        </section>

        {count > 0 && (
          <aside className="gg-tc-cartpage__summary" aria-labelledby="gg-tc-summary-title">
            <h2 id="gg-tc-summary-title">Trade summary</h2>
            {terms?.localPickupEnabled && <HandoffChoice value={method} terms={terms} disabled={starting} onChange={setHandoff} />}
            {active ? (
              method === "local" ? (
                <LocalCartSummary terms={active} count={count} totalCents={total} />
              ) : (
                <TradeSummary terms={active} count={count} totalCents={total} />
              )
            ) : (
              <p className="gg-tc-line__meta" role="status">
                Loading our current rates…
              </p>
            )}
            {error && (
              <p className="gg-alert gg-alert-error" role="alert">
                {error}
              </p>
            )}
            {open ? (
              <>
                {active && (
                  <p
                    className={belowMinimum ? "gg-tc-minimum gg-tc-minimum--short" : "gg-tc-minimum gg-tc-minimum--met"}
                    id="gg-tc-cart-minimum"
                  >
                    {minimumMessage(total, active.minTradeValueCents)}
                  </p>
                )}
                <button
                  type="button"
                  className="gg-btn gg-tc-cartpage__start"
                  disabled={starting || belowMinimum}
                  aria-describedby={active ? "gg-tc-cart-minimum" : undefined}
                  onClick={() => void start()}
                >
                  {starting ? "Starting…" : user ? "Start my trade" : "Sign in to start my trade"}
                </button>
                <p className="gg-tc-line__meta">
                  Starting a trade doesn&rsquo;t reserve these yet: they stay on sale until we&rsquo;ve approved your trade and you confirm
                  it.{method === "local" ? " Then we hold them while we set up a time to meet." : ""}
                </p>
              </>
            ) : (
              <p className="gg-tc-line__meta">{terms?.paused ? terms.pauseMessage : "You can start a trade once trading opens."}</p>
            )}
          </aside>
        )}

        <div className="gg-tc-cartpage__info">
          {/* Opens on the way they've chosen in the summary (remounts when that changes). */}
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

/** The cart's totals, and the TCG low value of the customer's cards it takes to cover ours. */
function TradeSummary({ terms, count, totalCents }: { terms: TradeTerms; count: number; totalCents: number }) {
  const shippingCents = tradeShippingCents(totalCents, terms);
  const neededCents = requiredValueCents(totalCents, terms.creditRatePercent, terms.processingFeeCents);
  const freeFrom =
    terms.freeShipFeeCents > 0
      ? `${moneyShort(terms.freeShipFeeCents)} from ${moneyShort(terms.freeShipThresholdCents)}`
      : `free from ${moneyShort(terms.freeShipThresholdCents)}`;
  return (
    <>
      <dl className="gg-tc-sum">
        <div>
          <dt>Our cards ({count})</dt>
          <dd>{formatCents(totalCents)}</dd>
        </div>
        <div>
          <dt>
            Shipping our cards to you
            <span className="gg-tc-sum__hint">
              {shippingCents === 0 ? "Tracked, on us" : `Tracked, ${freeFrom} · paid by card when your trade is final`}
            </span>
          </dt>
          <dd>{shippingLabel(shippingCents, totalCents)}</dd>
        </div>
      </dl>
      <div className="gg-tc-sum__need">
        <p className="gg-tc-sum__needfig" aria-live="polite" aria-atomic="true">
          <span className="gg-tc-sum__needlabel">To cover our cards, trade in </span>
          <strong className="gg-tc-sum__needvalue">{formatCents(neededCents)}</strong>
          <span className="gg-tc-sum__needsub"> of your cards at TCG low</span>
        </p>
        <p className="gg-tc-sum__needhint">
          At {terms.creditRatePercent}% trade credit{terms.processingFeeCents > 0 ? `, after the ${formatCents(terms.processingFeeCents)} processing fee` : ""}.
          Trade in less and pay the rest by card, or more and keep the extra as store credit.
        </p>
      </div>
      <TradeShippingProgress compact hideFee wantedCents={totalCents} terms={terms} />
    </>
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
        Confirming a trade takes our cards off sale for you, so trades with {formatCents(threshold)} or more of our cards need a small
        deposit to confirm. It comes back in full as soon as the carrier accepts your package by your shipping deadline.
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
