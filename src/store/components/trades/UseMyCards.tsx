import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabase";
import { Link, useRouter } from "../../lib/router";
import { useAuth } from "../../lib/AuthContext";
import { useCart, type CartLine } from "../../lib/CartContext";
import { formatCents } from "../../lib/money";
import { authLinkWithReturn } from "../../lib/authRedirect";
import { tradeActions, useTradeTerms } from "../../lib/tradeCenterApi";
import {
  MY_TRADES_PATH,
  STORE_CREDIT_PATH,
  USE_MY_CARDS_CHECKOUT_PATH,
  heldDuringReview,
  myTradePath,
  termsForHandoff,
  tradingOpen,
  type TradeHandoffMethod,
  type TradeTerms,
} from "../../lib/tradeCenter";
import { minimumMessage, requiredValueCents, shippingLabel, tradeShippingCents } from "../../lib/tradeShipping";
import { confirmWindow, plural } from "../../lib/tradeFaq";
import { TradeShippingProgress } from "./TradeShippingProgress";
import { HandoffChoice, LocalCartSummary } from "./LocalPickup";
import { TradeWantedList } from "./TradeWantedList";

// "Use My Magic Cards": trading toward the cards in the normal shopping cart.
// Shown at checkout (beside Pay Normally) and on the trading page. It reads
// the cart, works out what our cards count for in a trade (their regular
// price: sale and member prices don't apply; a consigned copy can't be
// traded and stays in the cart to buy normally), shows the minimum, and
// starts the trade from the tradeable cards. Those cards then leave the cart
// (they live on the trade) and the customer goes on to list their cards.
// The server is the source of truth: it prices our cards again, checks
// stock and the minimum, and refuses consigned cards (trade_start).

interface Quote {
  /** Our regular price for a trade, or null when the copy can't be traded (consigned). */
  tradePriceCents: number | null;
}

/**
 * What each cart line counts for in a trade: the regular price (the listing's
 * price before any deal or storewide sale), as trade_regular_price works it out.
 */
function useTradeQuotes(lines: CartLine[]): {
  quotes: Map<string, Quote>;
  loading: boolean;
} {
  const key = useMemo(() => [...new Set(lines.map((l) => l.inventoryItemId))].sort().join(","), [lines]);
  const [state, setState] = useState<{
    key: string;
    quotes: Map<string, Quote>;
  }>({ key: "", quotes: new Map() });

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",");
    let live = true;
    void (async () => {
      const { data, error } = await supabase
        .from("inventory_public")
        .select("id, price_cents, original_price_cents, sale_only")
        .in("id", ids);
      if (!live) return;
      const quotes = new Map<string, Quote>();
      if (!error) {
        for (const row of data ?? []) {
          const regular = row.original_price_cents ?? row.price_cents;
          quotes.set(row.id as string, {
            tradePriceCents: row.sale_only ? null : (regular ?? null),
          });
        }
      }
      setState({ key, quotes });
    })();
    return () => {
      live = false;
    };
  }, [key]);

  return { quotes: state.quotes, loading: key !== "" && state.key !== key };
}

interface UseMyCardsPanelProps {
  headingLevel?: 2 | 3;
  /** The way to trade, when the page around the panel follows it (otherwise the panel keeps its own). */
  handoff?: TradeHandoffMethod;
  onHandoffChange?: (method: TradeHandoffMethod) => void;
}

export function UseMyCardsPanel({ headingLevel = 2, handoff: controlled, onHandoffChange }: UseMyCardsPanelProps) {
  const terms = useTradeTerms();
  const { lines, removeItem, setQuantity, loading: cartLoading } = useCart();
  const { user } = useAuth();
  const { navigate } = useRouter();
  const { quotes, loading: quoting } = useTradeQuotes(lines);
  const [own, setOwn] = useState<TradeHandoffMethod>("ship");
  const handoff = controlled ?? own;
  const setHandoff = (method: TradeHandoffMethod) => {
    setOwn(method);
    onHandoffChange?.(method);
  };
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const method: TradeHandoffMethod = handoff === "local" && terms?.localPickupEnabled ? "local" : "ship";
  const active = terms ? termsForHandoff(terms, method) : null;
  const open = tradingOpen(terms);

  // Lines whose quote hasn't arrived yet count at their cart price for now.
  const tradeable = lines
    .filter((l) => !l.saleOnly && quotes.get(l.inventoryItemId)?.tradePriceCents !== null)
    .map((l) => ({
      line: l,
      unitCents: quotes.get(l.inventoryItemId)?.tradePriceCents ?? l.priceCents,
    }));
  const saleOnly = lines.filter((l) => !tradeable.some((t) => t.line.inventoryItemId === l.inventoryItemId));
  const count = tradeable.reduce((n, t) => n + t.line.quantity, 0);
  const totalCents = tradeable.reduce((sum, t) => sum + t.unitCents * t.line.quantity, 0);
  const belowMinimum = active !== null && totalCents < active.minTradeValueCents;
  const Heading = headingLevel === 2 ? "h2" : "h3";

  async function start() {
    if (!user) {
      navigate(authLinkWithReturn("/login", USE_MY_CARDS_CHECKOUT_PATH));
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await tradeActions.start(
        tradeable.map((t) => ({
          inventoryItemId: t.line.inventoryItemId,
          quantity: t.line.quantity,
        })),
        method,
      );
      // They're on the trade now: off the cart, so they aren't bought twice.
      for (const t of tradeable) {
        try {
          await removeItem(t.line.inventoryItemId);
        } catch {
          // The trade has them either way; a line left in the cart is only cosmetic.
        }
      }
      navigate(myTradePath(res.trade.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't start your trade. Try again.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="gg-usecards" aria-labelledby="gg-usecards-title">
      <Heading id="gg-usecards-title" className="gg-usecards__title">
        Use My Magic Cards
      </Heading>
      <p className="gg-usecards__lead">Have Magic cards you&rsquo;re not using? Trade them toward the cards in your cart!</p>
      {active && (
        <p className="gg-usecards__rule">
          Eligible cards earn <strong>{active.creditRatePercent}%</strong> of their TCG low value in trade credit, confirmed when we check
          them. Pay any remaining balance by card.
        </p>
      )}

      {terms && !terms.enabled && <p className="gg-tc-banner">Trading online opens soon. Check back shortly, or email us about a trade.</p>}
      {terms?.enabled && terms.paused && <p className="gg-tc-banner">{terms.pauseMessage}</p>}

      {cartLoading && lines.length === 0 ? (
        <p className="gg-tc-line__meta" role="status">
          Loading your cart…
        </p>
      ) : lines.length === 0 ? (
        <div className="gg-usecards__empty">
          <p>Your cart is empty. Add the cards you&rsquo;d like, then come back here to trade toward them.</p>
          <Link to="/shop" className="gg-btn">
            Shop Magic cards
          </Link>
        </div>
      ) : (
        <>
          <Heading className="gg-usecards__sub">Step 1 of 3: the cards you want</Heading>
          <TradeWantedList
            rows={tradeable.map(({ line, unitCents }) => ({
              key: line.inventoryItemId,
              cardName: line.name,
              setCode: line.setCode,
              setName: line.setName,
              collectorNumber: null,
              condition: line.condition,
              finish: line.finish,
              imageUrl: line.imageUrl,
              quantity: line.quantity,
              unitPriceCents: unitCents,
              maxQuantity: Math.max(line.sellable, line.quantity),
              note: line.sellable < line.quantity ? `Only ${line.sellable} left` : null,
              noteTone: "warn" as const,
            }))}
            busy={starting}
            onQuantity={(key, quantity) => void setQuantity(key, quantity).catch(() => {})}
            onRemove={(key) => void removeItem(key).catch(() => {})}
          />
          <Link to="/shop" className="gg-usecards__more">
            Add more cards
          </Link>
          {saleOnly.length > 0 && (
            <p className="gg-tc-line__meta gg-usecards__saleonly">
              {saleOnly.map((l) => l.name).join(", ")}{" "}
              {saleOnly.length === 1 ? "is a consigned copy and can't" : "are consigned copies and can't"} be traded.{" "}
              {saleOnly.length === 1 ? "It stays" : "They stay"} in your cart to buy normally.
            </p>
          )}
          {tradeable.length > 0 && (
            <>
              <p className="gg-tc-line__meta">
                In a trade our cards count at their regular price: sale and member prices don&rsquo;t apply.
              </p>
              {terms?.localPickupEnabled && <HandoffChoice value={method} terms={terms} disabled={starting} onChange={setHandoff} />}
              {active &&
                (method === "local" ? (
                  <LocalCartSummary terms={active} count={count} totalCents={totalCents} />
                ) : (
                  <CartTradeSummary terms={active} count={count} totalCents={totalCents} />
                ))}
              {active && active.minTradeValueCents > 0 && (
                <p
                  className={belowMinimum ? "gg-tc-minimum gg-tc-minimum--short" : "gg-tc-minimum gg-tc-minimum--met"}
                  id="gg-usecards-minimum"
                >
                  {minimumMessage(totalCents, active.minTradeValueCents)}
                </p>
              )}
              {error && (
                <p className="gg-alert gg-alert-error" role="alert">
                  {error}
                  {/open trade/i.test(error) && (
                    <>
                      {" "}
                      <Link to={MY_TRADES_PATH}>See your trades</Link>
                    </>
                  )}
                </p>
              )}
              {open ? (
                <>
                  <button
                    type="button"
                    className="gg-btn gg-usecards__start"
                    disabled={starting || belowMinimum || quoting}
                    aria-describedby={active && active.minTradeValueCents > 0 ? "gg-usecards-minimum" : undefined}
                    onClick={() => void start()}
                  >
                    {starting ? "Starting…" : user ? "Continue: tell us what you're trading" : "Sign in to trade"}
                  </button>
                  <HoldNote terms={active} local={method === "local"} totalCents={totalCents} />
                </>
              ) : null}
            </>
          )}
        </>
      )}

      <p className="gg-usecards__credit">
        Not buying anything yet? <Link to={STORE_CREDIT_PATH}>Get store credit for my cards</Link> through our Sell program instead (it has its own rates, and no cards are held).
      </p>
    </section>
  );
}

/** What happens to our cards once the trade is sent, in a line. */
function HoldNote({ terms, local, totalCents }: { terms: TradeTerms | null; local: boolean; totalCents: number }) {
  if (!terms) return null;
  const confirm = `you'll have ${confirmWindow(terms.confirmationHours)} (not counting Sundays) to confirm`;
  const next = local
    ? "Next you’ll send your trade for review: no need to list your cards, just bring them when we meet."
    : "Next you’ll list the cards you’re trading in.";
  const after = heldDuringReview(terms, totalCents)
    ? local
      ? ` When you send it, we hold these for you for up to ${plural(terms.reviewHoldHours, "hour")} while we review it, then until we meet.`
      : ` When you send your trade, we hold these for you for up to ${plural(terms.reviewHoldHours, "hour")} while we review it; once approved ${confirm}.`
    : local
      ? " These stay on sale until we approve your trade; then we hold them until we meet."
      : terms.reviewHoldsEnabled
        ? ` We hold these for you once we approve your trade; then ${confirm}.`
        : " These stay on sale until your trade is approved and confirmed.";
  return (
    <p className="gg-tc-line__meta gg-usecards__hold">
      {next}
      {after}
    </p>
  );
}

/** The cart's trade totals: our cards, shipping them, and the TCG low value of theirs it takes to cover ours. */
function CartTradeSummary({ terms, count, totalCents }: { terms: TradeTerms; count: number; totalCents: number }) {
  const shippingCents = tradeShippingCents(totalCents, terms);
  const neededCents = requiredValueCents(totalCents, terms.creditRatePercent, terms.processingFeeCents);
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
              {shippingCents === 0 ? "Tracked, on us" : "Tracked · paid by card when your trade is final"}
            </span>
          </dt>
          <dd>{shippingLabel(shippingCents, totalCents)}</dd>
        </div>
      </dl>
      <div className="gg-tc-sum__need">
        <p className="gg-tc-sum__needfig" aria-live="polite" aria-atomic="true">
          <span className="gg-tc-sum__needlabel">To cover our cards, trade in about </span>
          <strong className="gg-tc-sum__needvalue">{formatCents(neededCents)}</strong>
          <span className="gg-tc-sum__needsub"> of your cards at TCG low</span>
        </p>
        <p className="gg-tc-sum__needhint">
          At {terms.creditRatePercent}% trade credit
          {terms.processingFeeCents > 0 ? `, after the ${formatCents(terms.processingFeeCents)} processing fee` : ""}. Trade in less and pay
          the rest by card, or more and keep the extra as store credit.
        </p>
      </div>
      <TradeShippingProgress compact hideFee wantedCents={totalCents} terms={terms} />
    </>
  );
}
