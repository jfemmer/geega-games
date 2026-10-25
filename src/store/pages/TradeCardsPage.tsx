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
import { breadcrumbJsonLd, faqJsonLd } from "../../seo/site";

// Trade Cards (/trade-cards): what trading with us is, how cards are valued,
// the customer's trade cart (our cards they picked with "Add to trade"), and
// starting a trade. Every number on this page comes from the Trade Center
// settings staff control (the rate, the minimum, condition values, hold
// times), so the page can't promise anything the trade itself won't do.

const EXAMPLE_MARKET_CENTS = 4000;

function faqItems(t: TradeTerms | null): { question: string; answer: string }[] {
  const rate = t ? `${t.creditRatePercent}%` : "a set share";
  const min = t ? formatCents(t.minCardValueCents) : "a set amount";
  const hold = t ? `${t.reservationHours} hours` : "a set time";
  const ship = t ? `${t.shipBusinessDays} business days` : "a few business days";
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
      question: "How long do you hold the cards I picked?",
      answer: `${hold} while you list your cards, and while we review your list. Once we approve it, you have ${ship} to mail your cards. Once you've added a tracking number, they stay held until your package arrives.`,
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
      answer: "Yes, any time before you mail your cards. We release the cards we were holding for you.",
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
      "Trade your Magic: The Gathering cards for singles from Geega Games. Pick our cards, list yours, and get trade credit toward them. We hold your cards while you trade.",
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
        "Our cards held for you while you trade",
        "Nothing's final until you accept",
      ]
    : ["Trade credit toward our singles", "Our cards held for you while you trade", "Nothing's final until you accept"];

  return (
    <div className="gg-page gg-tc-page">
      <section className="gg-collect-hero gg-tc-hero">
        <h1>Trade Your Magic Cards for Cards You Actually Want</h1>
        <p className="gg-collect-hero-sub">
          Pick cards from our shop, list the cards you&rsquo;re done with, and put their value toward yours
          {rate !== null ? `: ${rate}% of it as trade credit` : ""}. We hold the cards you picked while you trade.
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
                  {terms && (
                    <p className="gg-tc-line__meta">
                      Starting holds these cards for you for {terms.reservationHours} hours while you list the cards you&rsquo;re
                      trading in.
                    </p>
                  )}
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
            <strong>Start your trade.</strong> We hold your picks{terms ? ` for ${terms.reservationHours} hours` : ""} while you
            list the cards you&rsquo;re trading in.
          </li>
          <li>
            <strong>List your cards.</strong> Search for each card, or paste a list or upload a CSV. You&rsquo;ll see an estimate as
            you go.
          </li>
          <li>
            <strong>We review your list.</strong> We approve the cards we can take, or ask you for a change, and email you either
            way.
          </li>
          <li>
            <strong>Mail your cards.</strong> Ship them with tracking{terms ? ` within ${terms.shipBusinessDays} business days` : ""}.
            We inspect every card when it arrives.
          </li>
          <li>
            <strong>Accept your final offer.</strong> Pay any difference by card, or keep extra credit for next time. We ship your
            new cards.
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
