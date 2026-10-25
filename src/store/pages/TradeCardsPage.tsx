import { useState } from "react";
import { Link, useRouter } from "../lib/router";
import { useAuth } from "../lib/AuthContext";
import { useSEO } from "../lib/useSEO";
import { formatCents } from "../lib/money";
import { authLinkWithReturn } from "../lib/authRedirect";
import { SUPPORT_EMAIL } from "./StaticPages";
import { FaqSection, HeroPoints } from "../components/SellLandingSections";
import { TradeWantedList } from "../components/trades/TradeWantedList";
import { tradeActions, useTradeTerms } from "../lib/tradeCenterApi";
import { tradeCart, tradeCartCount, tradeCartTotalCents, useTradeCart } from "../lib/tradeCart";
import {
  CARD_CONDITIONS,
  CONDITION_NAMES,
  TRADE_CENTER_PATH,
  TRADE_FREE_SHIPPING_FROM_CENTS,
  TRADE_TRACKED_SHIPPING_CENTS,
  myTradePath,
  tradeCreditCents,
  tradingOpen,
  type TradeTerms,
} from "../lib/tradeCenter";
import { depositBands } from "../lib/tradeRules";
import { addQualifyingDays, storeDateKey, storeInstant, weekdayOfKey } from "../lib/tradeDeadlines";
import { breadcrumbJsonLd, faqJsonLd } from "../../seo/site";

// Trade Cards (/trade-cards): what trading with us is, how cards are valued,
// the deposit, the customer's trade cart (our cards they picked with "Add to
// trade"), and starting a trade. Every number on this page comes from the
// Trade Center settings staff control (the rate, the minimum, condition
// values, deadlines, deposits), so the page can't promise anything the trade
// itself won't do.

const EXAMPLE_MARKET_CENTS = 4000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Tuesday": the day a shipping window that opens Friday at 2 PM closes, worked out like a real deadline. */
function shipExampleDay(days: number): string {
  const friday = storeInstant(2026, 10, 30, 14); // Friday, October 30, 2026, 2:00 PM in St. Louis
  return WEEKDAYS[weekdayOfKey(storeDateKey(addQualifyingDays(friday, days)))];
}

function confirmWindow(t: TradeTerms | null): string {
  if (!t) return "a set time";
  return t.confirmationHours % 24 === 0 ? plural(t.confirmationHours / 24, "day") : plural(t.confirmationHours, "hour");
}

function faqItems(t: TradeTerms | null): { question: string; answer: string }[] {
  const rate = t ? `${t.creditRatePercent}%` : "a set share";
  const min = t ? formatCents(t.minCardValueCents) : "a set amount";
  const confirmHours = t ? plural(t.confirmationHours, "hour") : "a set time";
  const shipDays = t ? plural(t.shipDaysNew, "day") : "a few days";
  const deposits = t?.depositsEnabled ?? false;
  const threshold = t ? formatCents(t.depositThresholdCents) : "";
  return [
    {
      question: "What cards can I trade in?",
      answer: `Magic: The Gathering singles worth at least ${min} each in their condition. We match every card to its exact printing and finish, so search for yours or paste a list when you build your trade.`,
    },
    {
      question: "How is my trade credit worked out?",
      answer: `Each card starts at its market reference price (the current price on Scryfall, which comes from TCGplayer) for its finish, adjusted for condition. Your trade credit is ${rate} of what your cards are worth. We confirm values when we review your list and again when your cards arrive.`,
    },
    {
      question: "Do my cards have to cover everything I pick?",
      answer: "No. If your credit falls short, you pay the rest by card at the end, after you've accepted our final offer.",
    },
    {
      question: "What if my cards are worth more than the cards I picked?",
      answer: t?.cashPayoutEnabled
        ? "Credit left over stays in your account as store credit for your next order. Sometimes we can offer cash for it instead, at a lower rate; we'll say so in your final offer if we can."
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
      answer:
        t?.shippingPaidBy === "store"
          ? `We cover shipping your cards to us; we'll arrange it once your trade is approved. Our cards ship to you tracked: ${formatCents(TRADE_TRACKED_SHIPPING_CENTS)}, or free on ${formatCents(TRADE_FREE_SHIPPING_FROM_CENTS)} or more of our cards.`
          : `You pay to ship your cards to us (use a tracked service). Our cards ship to you tracked: ${formatCents(TRADE_TRACKED_SHIPPING_CENTS)}, or free on ${formatCents(TRADE_FREE_SHIPPING_FROM_CENTS)} or more of our cards.`,
    },
    {
      question: "What if my cards arrive in a different condition, or one is missing?",
      answer:
        "We value cards as they arrive, so a card in worse shape than listed is worth less, and one that's missing, wrong or not genuine can't be taken. Your final offer lists every change and why, and you decide whether to accept it.",
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
  const faq = faqItems(terms);

  useSEO({
    title: "Trade Your Magic Cards for Cards You Want | Geega Games",
    description:
      "Trade your Magic: The Gathering cards for singles from Geega Games. Pick our cards, list yours, and get trade credit toward them. Once your trade is approved and confirmed, we reserve our cards for you.",
    path: TRADE_CENTER_PATH,
    jsonLd: [breadcrumbJsonLd([{ name: "Trade cards", path: TRADE_CENTER_PATH }]), faqJsonLd(faq)],
  });

  const open = tradingOpen(terms);
  const rate = terms?.creditRatePercent ?? null;
  const count = tradeCartCount(cart);
  const total = tradeCartTotalCents(cart);

  async function start() {
    if (!user) {
      navigate(authLinkWithReturn("/login", TRADE_CENTER_PATH));
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await tradeActions.start(cart.map((c) => ({ inventoryItemId: c.inventoryItemId, quantity: c.quantity })));
      tradeCart.clear();
      navigate(myTradePath(res.trade.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't start your trade. Try again.");
    } finally {
      setStarting(false);
    }
  }

  const points = terms
    ? [
        `${terms.creditRatePercent}% of your cards' value as trade credit`,
        `Cards worth ${formatCents(terms.minCardValueCents)} or more each`,
        "Our cards reserved for you once you confirm",
        "Decline the final offer with no penalty",
      ]
    : ["Trade credit toward our singles", "Our cards reserved for you once you confirm", "Decline the final offer with no penalty"];

  return (
    <div className="gg-page gg-tc-page">
      <section className="gg-collect-hero gg-tc-hero">
        <h1>Trade Your Magic Cards for Cards You Actually Want</h1>
        <p className="gg-collect-hero-sub">
          Pick cards from our shop, list the cards you&rsquo;re done with, and put their value toward yours
          {rate !== null ? `: ${rate}% of it as trade credit` : ""}. Once we approve your trade and you confirm it, the cards you picked
          are reserved for you while yours are in the mail.
        </p>
        <HeroPoints points={points} />
        {terms && !terms.enabled && (
          <p className="gg-tc-banner">Trading online opens soon. Check back shortly, or email us about a trade.</p>
        )}
        {terms?.enabled && terms.paused && <p className="gg-tc-banner">{terms.pauseMessage}</p>}
        <div className="gg-collect-hero-actions">
          <Link to="/shop" className={count > 0 ? "gg-btn gg-btn-ghost" : "gg-btn"}>
            {count > 0 ? "Pick more cards" : "Browse cards to trade for"}
          </Link>
          {count > 0 && (
            <a href="#trade-cart" className="gg-btn">
              Review your trade ({count})
            </a>
          )}
        </div>
      </section>

      <section className="gg-collect-section" id="trade-cart">
        <h2>Your trade cart</h2>
        {count === 0 ? (
          <div className="gg-tc-cart-empty">
            <p>
              Start with what you want: tap <strong>Add to trade</strong> on any card in our shop. Your picks wait here until
              you start your trade.
            </p>
            <Link to="/shop" className="gg-btn gg-btn-ghost">
              Shop singles
            </Link>
          </div>
        ) : (
          <div className="gg-tc-cart">
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
            <div className="gg-tc-cart__foot">
              <p className="gg-tc-cart__total">
                Our cards: <strong>{formatCents(total)}</strong>
              </p>
              <p className="gg-tc-line__meta">
                Trade prices are our regular prices (sale prices don&rsquo;t apply to trades). We check each card is still
                available when you start.
              </p>
              {error && (
                <p className="gg-alert gg-alert-error" role="alert">
                  {error}
                </p>
              )}
              {open ? (
                <>
                  <button type="button" className="gg-btn" disabled={starting} onClick={() => void start()}>
                    {starting ? "Starting…" : user ? "Start my trade" : "Sign in to start my trade"}
                  </button>
                  <p className="gg-tc-line__meta">
                    Starting a trade doesn&rsquo;t reserve these yet: they stay on sale until we&rsquo;ve approved your trade and you
                    confirm it.
                  </p>
                </>
              ) : (
                <p className="gg-tc-line__meta">{terms?.paused ? terms.pauseMessage : "You can start a trade once trading opens."}</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="gg-collect-section">
        <h2>How it works</h2>
        <ol className="gg-collect-steps">
          <li>
            <strong>Pick our cards.</strong> Add the cards you want from our shop to your trade cart.
          </li>
          <li>
            <strong>List your cards.</strong> Start your trade, then search for each card, paste a list or upload a CSV.
            You&rsquo;ll see an estimate as you go. Nothing is reserved yet.
          </li>
          <li>
            <strong>We review your trade.</strong> We approve the cards we can take, or ask you for a change, and email you either
            way.
          </li>
          <li>
            <strong>Confirm it{terms ? ` within ${confirmWindow(terms)}` : ""}.</strong> Sundays don&rsquo;t count. Confirming
            reserves our cards for you
            {terms?.depositsEnabled ? `, with a refundable deposit on trades of ${formatCents(terms.depositThresholdCents)} or more` : ""}.
          </li>
          <li>
            <strong>Ship your cards{terms ? ` within ${plural(terms.shipDaysNew, "day")}` : ""}.</strong> Sundays don&rsquo;t count,
            and it counts once the carrier scans your package. We inspect every card when it arrives.
          </li>
          <li>
            <strong>Accept your final offer.</strong> Pay any difference by card, or keep extra credit for next time, and we ship your
            new cards. Or decline with no penalty and we mail yours back.
          </li>
        </ol>
      </section>

      <section className="gg-collect-section" id="values">
        <h2>How we value your cards</h2>
        <p className="gg-collect-lead">
          Each card starts at its market reference price: its current price on Scryfall, which comes from TCGplayer, for that
          exact printing and finish. Then condition counts:
        </p>
        {terms ? (
          <ValueTable terms={terms} />
        ) : (
          <p className="gg-collect-lead gg-collect-lead--center" role="status">
            Loading our current rates…
          </p>
        )}
        <ul className="gg-tc-rules">
          {terms && (
            <li>
              Cards worth less than <strong>{formatCents(terms.minCardValueCents)}</strong> each, in their condition, can&rsquo;t be
              traded.
            </li>
          )}
          <li>Our cards count at their regular price. Sale and member prices don&rsquo;t apply to trades.</li>
          {terms && terms.processingFeeCents > 0 && (
            <li>A processing fee of {formatCents(terms.processingFeeCents)} comes off each trade&rsquo;s credit.</li>
          )}
          <li>A card with no current market price is valued by hand when we review your list.</li>
          <li>Estimates are a starting point: we confirm values at review, and again when your cards arrive.</li>
        </ul>
      </section>

      {terms?.depositsEnabled && <DepositSection terms={terms} />}

      <FaqSection items={faq} />
      <p className="gg-collect-contact">
        Questions about a trade? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </div>
  );
}

function ValueTable({ terms }: { terms: TradeTerms }) {
  return (
    <div className="gg-tc-table-wrap">
      <table className="gg-tc-table gg-tc-valuetable">
        <caption>
          A card with a {formatCents(EXAMPLE_MARKET_CENTS)} market price, at {terms.creditRatePercent}% trade credit
        </caption>
        <thead>
          <tr>
            <th scope="col">Condition</th>
            <th scope="col">Counts at</th>
            <th scope="col">Card value</th>
            <th scope="col">Trade credit</th>
          </tr>
        </thead>
        <tbody>
          {CARD_CONDITIONS.map((code) => {
            const pct = terms.conditionPercents[code];
            const value = Math.round((EXAMPLE_MARKET_CENTS * pct) / 100);
            return (
              <tr key={code}>
                <th scope="row">{CONDITION_NAMES[code]}</th>
                <td>{pct}%</td>
                <td>{formatCents(value)}</td>
                <td>
                  <strong>{formatCents(tradeCreditCents(value, terms.creditRatePercent))}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The refundable deposit: when it's needed, how much, and exactly when it comes back. */
function DepositSection({ terms }: { terms: TradeTerms }) {
  const threshold = terms.depositThresholdCents;
  const bands = depositBands(terms);
  return (
    <section className="gg-collect-section" id="deposit">
      <h2>The refundable deposit</h2>
      <p className="gg-collect-lead">
        Confirming a trade takes our cards off sale for you, so trades with {formatCents(threshold)} or more of our cards need a small
        deposit to confirm. It comes back in full as soon as the carrier accepts your package by your shipping deadline.
      </p>
      <div className="gg-tc-table-wrap">
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
      </div>
      <ul className="gg-tc-rules">
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
    </section>
  );
}
