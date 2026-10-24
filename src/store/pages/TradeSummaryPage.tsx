import { useEffect, useState } from "react";
import { Link, useRouter } from "../lib/router";
import { useSEO } from "../lib/useSEO";
import { formatCents } from "../lib/money";
import { CONDITION_LABELS } from "../lib/conditionLabels";
import { loadTrade } from "../lib/tradeApi";
import {
  TRADE_PATH,
  TRADE_PRICING_NOTE,
  theirCardLabel,
  tradeBalanceLabel,
  type TradeView,
  type TradeYourCard,
} from "../lib/trades";
import { SUPPORT_EMAIL } from "./StaticPages";

// A confirmed trade, for the customer (/trade?t=…): the link staff text or
// email from Admin → Trade Evaluator. Every card on both sides with its
// price, the trade credit percentage, and how it adds up to what they pay or
// the credit they have left, exactly as saved when the trade was confirmed.
// The token in the link is the only key (api/trade.ts); the page is never
// indexed, and shows nothing about how to reach the customer.

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; trade: TradeView };

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function cardsLabel(cards: { quantity: number }[]): string {
  const total = cards.reduce((sum, card) => sum + card.quantity, 0);
  return total === 1 ? "1 card" : `${total} cards`;
}

function finishLabel(finish: string): string | null {
  return finish && finish !== "nonfoil" ? finish.charAt(0).toUpperCase() + finish.slice(1) : null;
}

function cardDetail(card: TradeYourCard): string {
  return [
    card.setName ?? card.setCode.toUpperCase(),
    card.collectorNumber ? `#${card.collectorNumber}` : null,
    CONDITION_LABELS[card.condition] ?? card.condition,
    finishLabel(card.finish),
    card.variantType,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function TradeSummaryPage() {
  useSEO({
    title: "Your Trade | Geega Games",
    description: "Every card and price in your trade with Geega Games.",
    path: TRADE_PATH,
    noIndex: true,
  });
  const { query } = useRouter();
  const token = query.get("t") ?? "";
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadTrade(token).then(
      (trade) => !cancelled && setState({ status: "ready", trade }),
      (err: unknown) =>
        !cancelled &&
        setState({ status: "error", message: err instanceof Error ? err.message : "Something went wrong. Please try again." }),
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === "loading") {
    return (
      <div className="gg-page gg-tradepage" aria-busy="true">
        <h1>Your trade</h1>
        <p className="gg-tradepage__intro" role="status">
          Loading your trade…
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="gg-page gg-tradepage">
        <h1>Your trade</h1>
        <div className="gg-alert gg-alert-error" role="alert">
          {state.message}
        </div>
        <p className="gg-tradepage__note">
          Questions about a trade? Email us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </div>
    );
  }

  return <TradeBreakdown trade={state.trade} />;
}

function TradeBreakdown({ trade }: { trade: TradeView }) {
  const first = trade.customerName.trim().split(/\s+/)[0];
  const balance = trade.balanceCents;
  return (
    <div className="gg-page gg-tradepage">
      <header className="gg-tradepage__head">
        <h1>Trade #{trade.tradeNumber}</h1>
        <p className="gg-tradepage__date">{dateLabel(trade.createdAt)}</p>
      </header>
      <p className="gg-tradepage__intro">
        {first ? `Hi ${first}, here` : "Here"}'s every card and price in your trade with Geega Games.
      </p>

      <section className="gg-tradepage__bottom" aria-label="What it comes to">
        <p className="gg-tradepage__bottom-label">{tradeBalanceLabel(balance)}</p>
        <p className="gg-tradepage__bottom-amount">{formatCents(Math.abs(balance))}</p>
        <p className="gg-tradepage__bottom-math">
          {formatCents(trade.creditCents)} trade credit − {formatCents(trade.yourCardsCents)} for our cards
        </p>
      </section>

      <section className="gg-tradepage__side" aria-labelledby="trade-theirs">
        <h2 id="trade-theirs">
          You traded in <span>{cardsLabel(trade.theirCards)}</span>
        </h2>
        {trade.theirCards.length === 0 ? (
          <p className="gg-tradepage__empty">No cards.</p>
        ) : (
          <ul className="gg-tradepage__lines">
            {trade.theirCards.map((card, i) => (
              <li key={i} className="gg-tradepage__line">
                <span className="gg-tradepage__line-name">{theirCardLabel(card, i)}</span>
                <span className="gg-tradepage__line-total">{formatCents(card.tcgLowCents * card.quantity)}</span>
                <span className="gg-tradepage__line-detail">TCG low</span>
                <span className="gg-tradepage__line-each">
                  {card.quantity} × {formatCents(card.tcgLowCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <dl className="gg-tradepage__sums">
          <div>
            <dt>TCG low total</dt>
            <dd>{formatCents(trade.theirTcgLowCents)}</dd>
          </div>
          <div className="gg-tradepage__credit">
            <dt>Trade credit at {trade.creditPercent}%</dt>
            <dd>{formatCents(trade.creditCents)}</dd>
          </div>
        </dl>
      </section>

      <section className="gg-tradepage__side" aria-labelledby="trade-yours">
        <h2 id="trade-yours">
          You got <span>{cardsLabel(trade.yourCards)}</span>
        </h2>
        {trade.yourCards.length === 0 ? (
          <p className="gg-tradepage__empty">No cards.</p>
        ) : (
          <ul className="gg-tradepage__lines">
            {trade.yourCards.map((card, i) => (
              <li key={i} className="gg-tradepage__line">
                <span className="gg-tradepage__line-name">{card.cardName}</span>
                <span className="gg-tradepage__line-total">{formatCents(card.priceCents * card.quantity)}</span>
                <span className="gg-tradepage__line-detail">{cardDetail(card)}</span>
                <span className="gg-tradepage__line-each">
                  {card.quantity} × {formatCents(card.priceCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <dl className="gg-tradepage__sums">
          <div>
            <dt>At our regular website prices</dt>
            <dd>{formatCents(trade.yourCardsCents)}</dd>
          </div>
        </dl>
      </section>

      <p className="gg-tradepage__note">{TRADE_PRICING_NOTE}</p>
      <p className="gg-tradepage__note">
        Questions about your trade? Email us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.{" "}
        <Link to="/shop">Browse the shop</Link>
      </p>
    </div>
  );
}
