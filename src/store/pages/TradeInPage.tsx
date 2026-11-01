import { Link } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { formatCents } from "../lib/money";
import { SUPPORT_EMAIL } from "./StaticPages";
import { FaqSection, ShopRatingLine } from "../components/SellLandingSections";
import { useTradeTerms } from "../lib/tradeCenterApi";
import { ADVERTISED_TRADE_TERMS } from "../lib/tradeAdvertised";
import { tradeFaqItems } from "../lib/tradeFaq";
import { CARD_CONDITIONS, CONDITION_NAMES, TRADE_CENTER_PATH, TRADE_IN_PATH, type TradeTerms } from "../lib/tradeCenter";
import { moneyShort, requiredValueCents } from "../lib/tradeShipping";
import { STORE_CREDIT_BONUS_PERCENT } from "../lib/sellTypes";
import { HUB_CITY, ORGANIZATION_ID, breadcrumbJsonLd, faqJsonLd, serviceAreaServed } from "../../seo/site";

// The trade-in landing page (/trade-in-magic-cards): what trading cards in
// to Geega Games is, at what rate, and how it works, written for people
// searching "trade in magic cards", "mtg trade in" and "trade magic cards
// for store credit". It's prerendered (src/seo/routes.ts), so the rate is
// in the HTML search engines read; the Trade Cards page (/trade-cards) is
// the cart that does the trading and stays where it is.
//
// The numbers come from the Trade Center settings. Until they load (and in
// the prerendered page) the advertised snapshot in tradeAdvertised.ts
// stands in, so the page never says "a set share" where a reader wants a
// number. The admin settings panel warns when the two disagree.

function CreditRateBadge({ rate }: { rate: number }) {
  return (
    <p className="gg-credit-badge">
      <strong>{rate}% of TCG low</strong> in store credit for every card we take
    </p>
  );
}

/** The worked example: what the minimum trade takes in your cards, at the rate. */
function MinimumExample({ t }: { t: TradeTerms }) {
  if (t.minTradeValueCents <= 0) return null;
  const needed = requiredValueCents(t.minTradeValueCents, t.creditRatePercent, t.processingFeeCents);
  return (
    <p className="gg-collect-lead">
      Trades start at <strong>{moneyShort(t.minTradeValueCents)}</strong> of our cards. At {t.creditRatePercent}% credit, that takes{" "}
      <strong>{formatCents(needed)}</strong> of your cards at TCG low to cover completely; if yours come to less, you pay the difference by
      card, and if they come to more, the extra stays in your account as store credit.
    </p>
  );
}

export default function TradeInPage() {
  const live = useTradeTerms();
  const t = live ?? ADVERTISED_TRADE_TERMS;
  const faq = tradeFaqItems(t);
  const closed = live !== null && (!live.enabled || live.paused);

  useSEO({
    title: `Trade In Magic Cards for ${t.creditRatePercent}% Store Credit | Geega Games`,
    description: `Trade in your Magic: The Gathering staples for ${t.creditRatePercent}% of TCG low in store credit toward any singles in our shop. Ship from anywhere in the US or meet up in ${HUB_CITY}. Cards worth ${moneyShort(t.minCardValueCents)}+ each.`,
    path: TRADE_IN_PATH,
    jsonLd: [
      breadcrumbJsonLd([{ name: "Trade in Magic cards", path: TRADE_IN_PATH }]),
      {
        "@context": "https://schema.org",
        "@type": "Service",
        serviceType: "Magic: The Gathering card trade-in",
        name: "Trade in Magic: The Gathering cards for store credit",
        provider: { "@id": ORGANIZATION_ID },
        areaServed: [...serviceAreaServed(), { "@type": "Country", name: "United States" }],
        description: `Geega Games takes Magic: The Gathering staples in trade at ${t.creditRatePercent}% of TCG low in store credit, by mail from anywhere in the US or in person around ${HUB_CITY}.`,
      },
      faqJsonLd(faq),
    ],
  });

  return (
    <div className="gg-page">
      <section className="gg-collect-hero">
        <h1>Trade in your Magic cards for {t.creditRatePercent}% of TCG low in store credit</h1>
        <p className="gg-collect-hero-sub">
          Pick the singles you want from our shop, send us the staples you don&rsquo;t play, and we credit{" "}
          {t.creditRatePercent}% of each card&rsquo;s TCG low toward your order. Ship from anywhere in the US
          {t.localPickupEnabled ? ` or meet up in ${t.localPickupArea}` : ""}. We take cards worth {moneyShort(t.minCardValueCents)} or more each
          at TCG low; no bulk.
        </p>
        <CreditRateBadge rate={t.creditRatePercent} />
        <div className="gg-collect-hero-actions">
          <Link to="/shop" className="gg-btn">
            Pick the cards you want
          </Link>
          <Link to={TRADE_CENTER_PATH} className="gg-btn gg-btn-ghost">
            Open my trade cart
          </Link>
        </div>
        <ShopRatingLine />
        {closed && (
          <p className="gg-area-note">
            {live.enabled ? live.pauseMessage : "Online trading opens soon. Check back shortly, or email us about a trade."}
          </p>
        )}
      </section>

      <section className="gg-collect-section">
        <h2>How a trade-in works</h2>
        <ol className="gg-collect-steps">
          <li>
            <strong>Choose our cards.</strong> Add singles from <Link to="/shop">the shop</Link> to your trade with &ldquo;Add to
            trade&rdquo;. {t.minTradeValueCents > 0 ? `Trades start at ${moneyShort(t.minTradeValueCents)} of our cards.` : ""}
          </li>
          <li>
            <strong>List the cards you&rsquo;re trading in.</strong> Search for each one or paste a list. Each card is priced at its TCG
            low for its printing, finish and condition, and you see the estimate as you go.
          </li>
          <li>
            <strong>We review and approve.</strong> You get {t.creditRatePercent}% of that total as credit toward the cards you picked. Once
            you confirm, our cards are reserved for you.
          </li>
          <li>
            <strong>Ship your cards, or meet us.</strong> Mail them tracked
            {t.localPickupEnabled ? `, or bring them to a meetup in ${t.localPickupArea}` : ""}. We check every card and send a final offer
            that lists any change and why; you decide, and anything your credit doesn&rsquo;t cover is paid by card.
          </li>
        </ol>
        <MinimumExample t={t} />
      </section>

      <section className="gg-collect-section">
        <h2>How your cards are valued</h2>
        <p className="gg-collect-lead">
          Every card is priced at its TCG low, TCGplayer&rsquo;s lowest listed price for that exact printing and finish, then adjusted for
          condition. Your trade credit is {t.creditRatePercent}% of the result.
        </p>
        <div className="gg-tc-table-wrap">
          <table className="gg-tc-table">
            <caption>Condition and the share of TCG low each one counts for</caption>
            <thead>
              <tr>
                <th scope="col">Condition</th>
                <th scope="col">Share of TCG low</th>
                <th scope="col">Trade credit at {t.creditRatePercent}%</th>
              </tr>
            </thead>
            <tbody>
              {CARD_CONDITIONS.map((code) => (
                <tr key={code}>
                  <th scope="row">{CONDITION_NAMES[code]}</th>
                  <td>{t.conditionPercents[code]}%</td>
                  <td>{Math.round((t.conditionPercents[code] * t.creditRatePercent) / 100)}% of TCG low</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="gg-area-note">
          Until we see your cards, each one starts at a condition based on its printing&rsquo;s age. When they arrive we check every card;
          one in better shape is worth more, one in worse shape is worth less, and your final offer shows every change.
        </p>
      </section>

      <section className="gg-collect-section">
        <h2>How {t.creditRatePercent}% store credit compares</h2>
        <p className="gg-collect-lead">
          Most buyers pay less for cards they will resell, and most pay more in credit than in cash. Here is how the usual options line up
          for a card with a $100 TCG low, in near-mint condition.
        </p>
        <div className="gg-tc-table-wrap">
          <table className="gg-tc-table gg-tc-table--text">
            <caption>What a $100 (TCG low) card is typically worth to you</caption>
            <thead>
              <tr>
                <th scope="col">Option</th>
                <th scope="col">What you get</th>
                <th scope="col">Typical value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Trade in to Geega Games</th>
                <td>Store credit toward any single in our shop</td>
                <td>${t.creditRatePercent}</td>
              </tr>
              <tr>
                <th scope="row">Sell to Geega Games, take store credit</th>
                <td>Our cash offer plus {STORE_CREDIT_BONUS_PERCENT}% in credit</td>
                <td>Offer + {STORE_CREDIT_BONUS_PERCENT}%</td>
              </tr>
              <tr>
                <th scope="row">Online buylist, cash</th>
                <td>Cash for cards on their list</td>
                <td>$50–$70</td>
              </tr>
              <tr>
                <th scope="row">Online buylist, store credit</th>
                <td>Their cash price plus a bonus, often 25–30%</td>
                <td>$65–$90</td>
              </tr>
              <tr>
                <th scope="row">Local game store</th>
                <td>Cash or credit for what they need that week</td>
                <td>$50–$70</td>
              </tr>
              <tr>
                <th scope="row">Sell it yourself (TCGplayer, eBay)</th>
                <td>The sale price minus about 13% in fees, after listing and shipping it</td>
                <td>$85–$90, less postage</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="gg-area-note">
          Buylist and store figures are typical ranges, not quotes; each store sets its own. Our{" "}
          <Link to="/guides/where-to-sell-magic-cards">where to sell Magic cards</Link> guide compares every option in more detail.
        </p>
      </section>

      <section className="gg-collect-section">
        <h2>What we take in trade</h2>
        <div className="gg-collect-grid">
          <div className="gg-collect-card">
            <h3>Staples worth {moneyShort(t.minCardValueCents)}+</h3>
            <p>
              Commander, Modern, Legacy and Pioneer staples, Reserved List cards, fetch and shock lands, and chase foils, each worth{" "}
              {moneyShort(t.minCardValueCents)} or more at TCG low in its condition.
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>Any printing, any finish</h3>
            <p>
              We match each card to its exact set, collector number and finish, so a borderless foil and a plain nonfoil each get their
              own price.
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>Not bulk</h3>
            <p>
              Commons, uncommons and cards under {moneyShort(t.minCardValueCents)} aren&rsquo;t taken in trade. Selling a whole collection,
              bulk included? <Link to="/sell-my-collection">Get a free offer</Link> instead; it pays cash or store credit worth{" "}
              {STORE_CREDIT_BONUS_PERCENT}% more.
            </p>
          </div>
        </div>
      </section>

      {t.localPickupEnabled && (
        <section className="gg-collect-section">
          <h2>Trade in person in {HUB_CITY}</h2>
          <p className="gg-collect-lead">
            Choose local pickup when you start your trade. You don&rsquo;t list your cards; once we approve the trade we hold our cards
            for you, set a time to meet in {t.localPickupArea}, and value each of yours together at its TCG low for the condition we see.
            Anything your {t.localCreditRatePercent}% credit doesn&rsquo;t cover is paid then, in cash or by card. No shipping, no deposit.
          </p>
          {t.localMeetSpotName && t.localMeetSpotAddress && (
            <p className="gg-area-note">
              Our usual meeting spot is {t.localMeetSpotName}, {t.localMeetSpotAddress}. Selling rather than trading?{" "}
              <Link to="/sell-magic-cards/st-louis">Sell Magic cards in St. Louis</Link>.
            </p>
          )}
        </section>
      )}

      <section className="gg-collect-section">
        <h2>Trade in or sell? Both pay in credit, in different ways</h2>
        <div className="gg-collect-grid">
          <div className="gg-collect-card">
            <h3>Trade in: {t.creditRatePercent}% of TCG low</h3>
            <p>
              For staples you&rsquo;d swap for other singles. The rate is fixed, every card is priced at TCG low, and the credit goes toward
              the cards you picked. <Link to={TRADE_CENTER_PATH}>Start a trade</Link>.
            </p>
          </div>
          <div className="gg-collect-card">
            <h3>Sell: a cash offer, or {STORE_CREDIT_BONUS_PERCENT}% more in credit</h3>
            <p>
              For whole collections, bulk and anything unsorted. We make one offer on the lot and you choose PayPal or store credit worth{" "}
              {STORE_CREDIT_BONUS_PERCENT}% more. <Link to="/sell-my-collection">Get a free offer</Link>.
            </p>
          </div>
        </div>
      </section>

      <FaqSection items={faq} />
      <p className="gg-collect-contact">
        Questions about a trade? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <section className="gg-collect-cta">
        <h2>Ready to trade?</h2>
        <p>Find the cards you want in the shop, tap &ldquo;Add to trade&rdquo;, and start your trade from the cart.</p>
        <div className="gg-collect-hero-actions">
          <Link to="/shop" className="gg-btn">
            Browse singles to trade for
          </Link>
          <Link to={TRADE_CENTER_PATH} className="gg-btn gg-btn-ghost">
            Open my trade cart
          </Link>
        </div>
      </section>
    </div>
  );
}
