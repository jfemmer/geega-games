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
  localTermsDiffer,
  meetSpotLine,
  meetSpotOf,
  myTradePath,
  termsForHandoff,
  tradingOpen,
  type TradeHandoffMethod,
  type TradeTerms,
} from "../lib/tradeCenter";
import { depositBands } from "../lib/tradeRules";
import { minimumMessage, moneyShort, requiredValueCents, shippingLabel, tradeShippingCents } from "../lib/tradeShipping";
import { conditionAgeSummary } from "../lib/tradeConditions";
import { addQualifyingDays, storeDateKey, storeInstant, weekdayOfKey } from "../lib/tradeDeadlines";
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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Tuesday": the day a shipping window that opens Friday at 2 PM closes, worked out like a real deadline. */
function shipExampleDay(days: number): string {
  const friday = storeInstant(2026, 10, 30, 14); // Friday, October 30, 2026, 2:00 PM in St. Louis
  return WEEKDAYS[weekdayOfKey(storeDateKey(addQualifyingDays(friday, days)))];
}

/** "Our cards ship to you tracked: $3.99, or free on $200 or more of our cards." */
function ourShipping(t: TradeTerms | null): string {
  if (!t) return "Our cards ship to you tracked, free on bigger trades.";
  const free = t.freeShipFeeCents > 0 ? moneyShort(t.freeShipFeeCents) : "free";
  return `Our cards ship to you tracked: ${moneyShort(t.shipFeeCents)}, or ${free} on ${moneyShort(t.freeShipThresholdCents)} or more of our cards.`;
}

/** "Local pickup trades: 85% trade credit, staples worth $5+ each at TCG low, and at least $40 of our cards." */
function localTermsSentence(t: TradeTerms): string {
  const minimum = t.localMinTradeValueCents > 0 ? `, and at least ${moneyShort(t.localMinTradeValueCents)} of our cards` : ", and no minimum trade";
  return `Local pickup trades run on their own terms: ${t.localCreditRatePercent}% trade credit, staples worth ${moneyShort(t.localMinCardValueCents)}+ each at TCG low${minimum}.`;
}

function faqItems(t: TradeTerms | null): { question: string; answer: string }[] {
  const rate = t ? `${t.creditRatePercent}%` : "a set share";
  const confirmHours = t ? plural(t.confirmationHours, "hour") : "a set time";
  const shipDays = t ? plural(t.shipDaysNew, "day") : "a few days";
  const deposits = t?.depositsEnabled ?? false;
  const threshold = t ? formatCents(t.depositThresholdCents) : "";
  const spot = meetSpotOf(t);
  return [
    {
      question: "What cards can I trade in?",
      answer: `Staples: Magic: The Gathering singles worth ${t ? `${moneyShort(t.minCardValueCents)}+` : "a set amount or more"} each at TCG low, in their condition. We're not taking bulk. We match every card to its exact printing and finish, so search for yours or paste a list when you build your trade.`,
    },
    {
      question: "How is my trade credit worked out?",
      answer: `When we review your list, we price each of your cards at its TCG low (TCGplayer's lowest listed price) for its condition and finish. Your trade credit is ${rate} of that. The estimates you see while you build your trade use today's market prices, so they're a rough guide.`,
    },
    {
      question: "How do you decide my cards' condition?",
      answer: `From when each printing came out: ${conditionAgeSummary()}. When your cards arrive we check every one, and a card in better or worse shape is worth more or less. Your final offer shows every change and why.`,
    },
    {
      question: "Is there a minimum trade?",
      answer: !t
        ? "Yes: each trade needs a minimum value of our cards, shown in your trade cart."
        : t.minTradeValueCents > 0
          ? `Yes: at least ${moneyShort(t.minTradeValueCents)} of our cards per trade, at their regular prices (shipping doesn't count toward it). You can add cards below that while you shop; you'll need to reach it to start your trade. At ${rate} trade credit, ${moneyShort(t.minTradeValueCents)} of our cards takes ${formatCents(requiredValueCents(t.minTradeValueCents, t.creditRatePercent, t.processingFeeCents))} of your cards at TCG low to cover completely.`
          : `Not right now: a trade can be any amount of our cards. Your trade cart shows how much of your cards, at TCG low, it takes to cover them at ${rate} trade credit.`,
    },
    {
      question: "Do my cards have to cover everything I pick?",
      answer: "No. If your credit falls short, you pay the rest by card at the end, after you've accepted our final offer.",
    },
    {
      question: "What if my cards are worth more than the cards I picked?",
      answer: t?.cashPayoutEnabled
        ? "Credit left over stays in your account as store credit for your next order. Sometimes we can offer cash for it instead, at a lower rate; we'll say so in your final offer if we can."
        : t?.localPickupEnabled && t.localCashPayoutEnabled
          ? "Credit left over stays in your account as store credit for your next order. On a local pickup trade we can sometimes pay it in cash instead, at a lower rate, when we meet."
          : "Credit left over stays in your account as store credit for your next order. It isn't paid out in cash.",
    },
    {
      question: "When are the cards I picked reserved for me?",
      answer: `When you confirm your approved trade. While you build your trade and while we review it, our cards stay on sale. Once we approve it you have ${confirmHours} to confirm (Sundays don't count). If a card sells before you confirm, we'll tell you and you can pick another.`,
    },
    {
      question: "How long do I have to ship my cards?",
      answer: t
        ? `${shipDays} from confirming, and Sundays don't count: confirm on a Friday at 2 PM and you'd ship by ${shipExampleDay(t.shipDaysNew)} at 2 PM. It counts as shipped when the carrier scans your package; a label on its own doesn't. After ${plural(t.loyaltyTier1Trades, "completed trade")} you get ${plural(t.shipDaysTier1, "day")}, and after ${t.loyaltyTier2Trades}, ${plural(t.shipDaysTier2, "day")}.`
        : `${shipDays} from confirming, and Sundays don't count. It counts as shipped when the carrier scans your package; a label on its own doesn't.`,
    },
    {
      question: "Is there a deposit?",
      answer: deposits
        ? `Trades with ${threshold} or more of our cards need a small refundable deposit to confirm. It's refunded in full, to your card, as soon as the carrier accepts your package by your shipping deadline, and declining our final offer never costs it. If you cancel after confirming and before shipping, or don't ship in time, it may be kept under our cancellation policy; a person reviews every case first. Smaller trades may need one too after earlier trades were canceled or not shipped.`
        : "Not right now. If a trade ever needs one, you'll see it, and its terms, before you confirm.",
    },
    {
      question: "Who pays for shipping?",
      answer: `${
        t?.shippingPaidBy === "store"
          ? "We cover shipping your cards to us; we'll arrange it once your trade is approved."
          : "You ship your cards to us at your cost, with tracking (we'll show you how to pack them)."
      } ${ourShipping(t)} It's paid by card when your trade is final, never out of your trade credit, and never charged on a trade that's canceled or declined.`,
    },
    {
      question: "What if my cards arrive in a different condition, or one is missing?",
      answer:
        "We check every card when it arrives. One in better shape than listed is worth more, and one in worse shape is worth less; a card that's missing, wrong or not genuine can't be taken. Your final offer lists every change and why, and you decide whether to accept it.",
    },
    {
      question: "What if I don't like the final offer?",
      answer: `Ask us to take another look, or decline it. ${t?.returnPolicy ?? "If you decline, we'll mail your cards back to you."}`,
    },
    {
      question: "Can I cancel a trade?",
      answer:
        "Yes. Before you confirm, it costs nothing. After you confirm, our cards are reserved for you, so canceling before you ship counts against future trades, and a deposit on the trade may be kept under our cancellation policy (we review every case). Once the carrier has your package you can still cancel with no penalty, and we'll mail your cards back.",
    },
    ...(t?.localPickupEnabled
      ? [
          {
            question: "Can I trade in person?",
            answer: `Yes, in ${t.localPickupArea}: choose local pickup when you start your trade. You don't list your cards; we approve the trade, you confirm it, and we hold our cards for you for ${plural(t.localMeetDays, "day")} (Sundays don't count) while we set a time to meet${spot ? ` at our meeting spot, ${meetSpotLine(spot)}` : " in a public place"}. Bring your cards and we'll value each one at its TCG low for the condition we see, together. Anything your ${t.localCreditRatePercent}% trade credit doesn't cover is paid then, in cash or by card. There's no deposit and no shipping.${localTermsDiffer(t) ? ` ${localTermsSentence(t)}` : ""}`,
          },
        ]
      : []),
    {
      question: "Do I need an account?",
      answer: "Yes. Trades live in your account, where you'll see every card, price, message and deadline.",
    },
  ];
}

export default function TradeCardsPage() {
  const terms = useTradeTerms();
  const cart = useTradeCart();
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<TradeHandoffMethod>("ship");
  const faq = faqItems(terms);

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
