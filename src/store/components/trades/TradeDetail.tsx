import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouter } from "../../lib/router";
import { formatCents } from "../../lib/money";
import { carrierLabel, trackingUrlFor } from "../../lib/tracking";
import { useNow } from "../../lib/useNow";
import { loadTrade, tradeActions, useTradeTerms, type TradeResponse } from "../../lib/tradeCenterApi";
import { tradeCart, useTradeCart } from "../../lib/tradeCart";
import {
  BLOCKING_ELIGIBILITY,
  CLOSED_TRADE_STATUSES,
  CUSTOMER_CANCELABLE_STATUSES,
  CUSTOMER_EDITABLE_STATUSES,
  MY_TRADES_PATH,
  TRADE_CENTER_PATH,
  TRADE_LIMITS,
  TRADE_STATUS_LABELS,
  TRADE_STATUS_NEXT,
  TRADE_STEPS,
  cardLine,
  copiesToReturn,
  formatDeadline,
  timeLeft,
  tradeLabel,
  tradeStepIndex,
  type CustomerTrade,
  type TradeOfferInput,
  type TradeWantedInput,
} from "../../lib/tradeCenter";
import { TradeBalance } from "./TradeBalance";
import { TradeWantedList, type TradeWantedRow } from "./TradeWantedList";
import { OfferCardsEditor } from "./OfferCardsEditor";
import { TradeShippingPanel } from "./TradeShippingPanel";
import { TradeFinalOffer } from "./TradeFinalOffer";
import { TradePaymentPanel } from "./TradePaymentPanel";
import { TradeMessages, TradeTimeline } from "./TradeMessages";

// Account → Trades → one trade: everything about it in one place, changing
// with where it stands. While the customer builds their list: our cards
// (held for them), their cards (search, paste or CSV, each priced by the
// server), the running total, and "Send for review". Then the wait, the
// shipping instructions and tracking, the final offer and its answer, the
// payment, and how it all settled. Messages and history all the way through.

const ESTIMATED = new Set(["awaiting_trade_list", "revision_requested", "pending_review"]);
const APPROVED = new Set(["awaiting_shipment", "in_transit", "received", "under_inspection"]);

export default function TradeDetail({ tradeId }: { tradeId: string }) {
  const { query, navigate } = useRouter();
  const terms = useTradeTerms();
  const cart = useTradeCart();
  const [trade, setTrade] = useState<CustomerTrade | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showDeclineFromPayment, setShowDeclineFromPayment] = useState(false);
  const paymentChecked = useRef(false);
  const now = useNow();

  const reload = useCallback(async () => {
    try {
      setTrade((await loadTrade(tradeId)).trade);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "We couldn't load this trade.");
    }
  }, [tradeId]);

  useEffect(() => {
    let cancelled = false;
    loadTrade(tradeId)
      .then((res) => {
        if (!cancelled) setTrade(res.trade);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "We couldn't load this trade.");
      });
    return () => {
      cancelled = true;
    };
  }, [tradeId]);

  // Back from a bank check during card payment: pick the payment up.
  const returnedIntent = query.get("payment_intent");
  useEffect(() => {
    if (!returnedIntent || paymentChecked.current) return;
    paymentChecked.current = true;
    tradeActions
      .confirmPayment(tradeId, returnedIntent)
      .then((res) => {
        setTrade(res.trade);
        if (res.paymentStatus === "succeeded") setNotice("Payment received. Your trade is complete!");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "We couldn't check your payment."))
      .finally(() => navigate(window.location.pathname, { replace: true }));
  }, [returnedIntent, tradeId, navigate]);

  async function run(label: string, fn: () => Promise<TradeResponse>, done?: string): Promise<boolean> {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      setTrade(res.trade);
      if (done) setNotice(done);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      void reload();
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (loadError && !trade) {
    return (
      <div className="gg-tc-detail">
        <p className="gg-alert gg-alert-error" role="alert">
          {loadError}
        </p>
        <Link to={MY_TRADES_PATH}>Back to your trades</Link>
      </div>
    );
  }
  if (!trade) return <p className="gg-tc-line__meta">Loading your trade…</p>;

  const status = trade.status;
  const editable = CUSTOMER_EDITABLE_STATUSES.includes(status);
  const held = trade.wanted.filter((w) => w.status !== "released");
  const wantedInputs: TradeWantedInput[] = held.map((w) => ({ inventoryItemId: w.inventoryItemId as string, quantity: w.quantity }));
  const fromCart = cart.filter((c) => !held.some((w) => w.inventoryItemId === c.inventoryItemId));
  const blocked = trade.offered.filter((c) => BLOCKING_ELIGIBILITY.has(c.eligibility));
  const valueLabel = ESTIMATED.has(status) ? "estimated" : APPROVED.has(status) ? "approved" : "final";
  const value =
    valueLabel === "estimated" ? trade.estimatedValueCents : valueLabel === "approved" ? (trade.approvedValueCents ?? 0) : (trade.finalValueCents ?? 0);
  const step = tradeStepIndex(status);
  const finished = status === "approved_for_fulfillment" || status === "completed";
  const lastStaffMessage = [...trade.messages].reverse().find((m) => m.authorType === "staff");

  const wantedRows: TradeWantedRow[] = trade.wanted.map((w) => ({
    key: w.id,
    cardName: w.cardName,
    setCode: w.setCode,
    setName: w.setName,
    collectorNumber: w.collectorNumber,
    condition: w.condition,
    finish: w.finish,
    imageUrl: w.imageUrl,
    quantity: w.quantity,
    unitPriceCents: w.unitPriceCents,
    released: w.status === "released",
  }));

  const setWanted = (items: TradeWantedInput[], done?: string) => run("wanted", () => tradeActions.setWanted(tradeId, items), done);
  const saveOffer = (cards: TradeOfferInput[]) => run("offer", () => tradeActions.saveOffer(tradeId, cards));

  const submitProblems = [
    ...(trade.offered.length === 0 ? ["Add the cards you're trading in."] : []),
    ...(blocked.length > 0 ? [`Take off the ${blocked.length === 1 ? "card" : `${blocked.length} cards`} we can't accept.`] : []),
    ...(held.length === 0 ? ["Add at least one of our cards."] : []),
  ];

  return (
    <div className="gg-tc-detail">
      <header className="gg-tc-head">
        <div>
          <p className="gg-tc-head__id">Trade {tradeLabel(trade.tradeNumber)}</p>
          <h2 className="gg-tc-head__status">{TRADE_STATUS_LABELS[status]}</h2>
          <p className="gg-tc-head__next">{TRADE_STATUS_NEXT[status]}</p>
          {editable && trade.holdExpiresAt && (
            <p className="gg-tc-deadline">
              Our cards are held for you until <strong>{formatDeadline(trade.holdExpiresAt)}</strong> (
              {timeLeft(Date.parse(trade.holdExpiresAt), now)} left).
            </p>
          )}
        </div>
        {step >= 0 && (
          <ol className="gg-tc-steps" aria-label="Trade progress">
            {TRADE_STEPS.map((s, i) => (
              <li
                key={s.key}
                className={i < step ? "gg-tc-steps__done" : i === step ? "gg-tc-steps__now" : undefined}
                aria-current={i === step ? "step" : undefined}
              >
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
        )}
      </header>

      {notice && (
        <p className="gg-alert gg-alert-ok" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="gg-alert gg-alert-error" role="alert">
          {error}
        </p>
      )}

      {status === "revision_requested" && lastStaffMessage && (
        <div className="gg-tc-ask">
          <h3>What we need changed</h3>
          <p>{lastStaffMessage.body}</p>
        </div>
      )}

      {CLOSED_TRADE_STATUSES.has(status) && !finished && status !== "returned" && (
        <div className="gg-tc-panel gg-tc-closed">
          {trade.closeReason && <p>{trade.closeReason}</p>}
          <Link to={TRADE_CENTER_PATH} className="gg-btn gg-btn-ghost">
            Start a new trade
          </Link>
        </div>
      )}

      <div className="gg-tc-grid">
        <div className="gg-tc-main">
          {status === "awaiting_shipment" || status === "in_transit" ? (
            <TradeShippingPanel
              trade={trade}
              terms={terms}
              busy={busy === "tracking"}
              onTracking={(carrier, number) => run("tracking", () => tradeActions.tracking(tradeId, carrier, number), "Thanks! We'll watch for your package.")}
            />
          ) : null}

          {status === "awaiting_final_approval" && (
            <TradeFinalOffer
              trade={trade}
              busy={busy === "answer"}
              onAccept={(shipTo) => run("answer", () => tradeActions.accept(tradeId, shipTo))}
              onAdjust={(message) => run("answer", () => tradeActions.adjust(tradeId, message), "Sent. We'll take another look and reply here.")}
              onDecline={(reason) => run("answer", () => tradeActions.decline(tradeId, reason))}
            />
          )}

          {status === "awaiting_payment" && (
            <>
              <TradePaymentPanel
                trade={trade}
                onStart={async () => {
                  setError(null);
                  try {
                    const res = await tradeActions.pay(tradeId);
                    if ("paid" in res) {
                      setTrade(res.trade);
                      return null;
                    }
                    return res;
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "We couldn't start the payment.");
                    return null;
                  }
                }}
                onPaid={async (paymentIntentId) => {
                  await run("pay", () => tradeActions.confirmPayment(tradeId, paymentIntentId), "Payment received. Your trade is complete!");
                }}
                onDecline={() => setShowDeclineFromPayment(true)}
              />
              {showDeclineFromPayment && (
                <div className="gg-tc-subform gg-tc-subform--warn">
                  <p>{trade.returnPolicy}</p>
                  <div className="gg-tc-pick__actions">
                    <button
                      type="button"
                      className="gg-btn gg-tc-btn-danger"
                      disabled={busy !== null}
                      onClick={() => void run("answer", () => tradeActions.decline(tradeId, null))}
                    >
                      Decline and return my cards
                    </button>
                    <button type="button" className="gg-linkbtn" onClick={() => setShowDeclineFromPayment(false)}>
                      Keep my trade
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {finished && <Settled trade={trade} />}

          {(status === "return_pending" || status === "returned") && <Returning trade={trade} />}

          <section className="gg-tc-panel" aria-labelledby="gg-tc-ours-title">
            <h2 id="gg-tc-ours-title">Our cards</h2>
            {editable && <p className="gg-tc-line__meta">Prices are our regular prices, set when each card was added to your trade.</p>}
            <TradeWantedList
              rows={wantedRows}
              busy={busy === "wanted"}
              onQuantity={
                editable
                  ? (key, quantity) => {
                      const item = held.find((w) => w.id === key);
                      if (item) void setWanted(wantedInputs.map((i) => (i.inventoryItemId === item.inventoryItemId ? { ...i, quantity } : i)));
                    }
                  : undefined
              }
              onRemove={
                editable && held.length > 1
                  ? (key) => {
                      const item = held.find((w) => w.id === key);
                      if (item) void setWanted(wantedInputs.filter((i) => i.inventoryItemId !== item.inventoryItemId));
                    }
                  : undefined
              }
            />
            {editable && fromCart.length > 0 && (
              <div className="gg-tc-cartmerge">
                <p>
                  You have {fromCart.length} more card{fromCart.length === 1 ? "" : "s"} in your trade cart.
                </p>
                <button
                  type="button"
                  className="gg-btn gg-btn-sm"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await setWanted(
                      [...wantedInputs, ...fromCart.map((c) => ({ inventoryItemId: c.inventoryItemId, quantity: c.quantity }))],
                      "Added to your trade, and held for you.",
                    );
                    if (ok) fromCart.forEach((c) => tradeCart.remove(c.inventoryItemId));
                  }}
                >
                  Add them to this trade
                </button>
              </div>
            )}
            {editable && (
              <p className="gg-tc-line__meta">
                Want more? <Link to="/shop">Browse the shop</Link> and tap &ldquo;Add to trade&rdquo; on any card.
              </p>
            )}
          </section>

          <section className="gg-tc-panel" aria-labelledby="gg-tc-theirs-title">
            <h2 id="gg-tc-theirs-title">Your cards</h2>
            {editable && (
              <p className="gg-tc-line__meta">
                Each card is valued at its market reference price for its condition. Cards worth less than{" "}
                {formatCents(trade.minCardValueCents)} each can&rsquo;t be traded.
              </p>
            )}
            <OfferCardsEditor trade={trade} terms={terms} editable={editable} saving={busy === "offer"} onSave={saveOffer} />
          </section>

        </div>

        {!finished && !CLOSED_TRADE_STATUSES.has(status) && status !== "return_pending" && (
          <aside className="gg-tc-aside">
            <TradeBalance
              wantedCents={trade.wantedTotalCents}
              offeredValueCents={value}
              valueLabel={valueLabel}
              ratePercent={trade.creditRatePercent}
              feeCents={trade.processingFeeCents}
              shippingCents={trade.shippingCents ?? undefined}
              footnote={
                valueLabel === "estimated"
                  ? "Market prices are a starting point. We confirm values when we review your list and again when your cards arrive."
                  : valueLabel === "approved"
                    ? "Final values are confirmed when your cards arrive and we inspect them."
                    : null
              }
            >
              {editable && (
                <form
                  className="gg-tc-submit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("submit", () => tradeActions.submit(tradeId, note.trim() || null), "Sent! We'll email you when we've reviewed your cards.");
                  }}
                >
                  <label className="gg-field">
                    <span>Note for us (optional)</span>
                    <textarea rows={2} maxLength={TRADE_LIMITS.maxTradeNote} value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  {submitProblems.length > 0 && (
                    <ul className="gg-tc-submit__todo">
                      {submitProblems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                  <button type="submit" className="gg-btn gg-tc-submit__btn" disabled={busy !== null || submitProblems.length > 0}>
                    {busy === "submit" ? "Sending…" : status === "revision_requested" ? "Send my changes" : "Send for review"}
                  </button>
                  <p className="gg-tc-line__meta">Don&rsquo;t mail anything yet. If we approve your cards, we&rsquo;ll tell you where to send them.</p>
                </form>
              )}
            </TradeBalance>
          </aside>
        )}

        <div className="gg-tc-below">
          <TradeMessages
            messages={trade.messages}
            busy={busy === "message"}
            onSend={(body) => run("message", () => tradeActions.message(tradeId, body), "Message sent.")}
          />
          <TradeTimeline entries={trade.timeline} />

          {CUSTOMER_CANCELABLE_STATUSES.includes(status) && (
            <div className="gg-tc-cancel">
              {confirmCancel ? (
                <>
                  <p>Cancel this trade? We&rsquo;ll release our cards and you won&rsquo;t be able to undo it.</p>
                  <button type="button" className="gg-btn gg-tc-btn-danger" disabled={busy !== null} onClick={() => void run("cancel", () => tradeActions.cancel(tradeId, null))}>
                    Yes, cancel my trade
                  </button>{" "}
                  <button type="button" className="gg-linkbtn" onClick={() => setConfirmCancel(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="gg-linkbtn" onClick={() => setConfirmCancel(true)}>
                  Cancel this trade
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Settled({ trade }: { trade: CustomerTrade }) {
  const due = trade.amountDueCents ?? 0;
  const spent = trade.wantedTotalCents + (trade.shippingCents ?? 0) - due;
  const cash = trade.excessHandling === "cash" ? (trade.cashPayoutCents ?? 0) : 0;
  return (
    <section className="gg-tc-panel gg-tc-settled" aria-labelledby="gg-tc-settled-title">
      <h2 id="gg-tc-settled-title">How your trade settled</h2>
      <dl className="gg-tc-balance__rows">
        <div>
          <dt>Trade credit issued</dt>
          <dd>{formatCents(trade.creditIssuedCents ?? 0)}</dd>
        </div>
        <div>
          <dt>Used on your order</dt>
          <dd>{formatCents(Math.max(spent, 0))}</dd>
        </div>
        {due > 0 && (
          <div>
            <dt>Paid by card</dt>
            <dd>{formatCents(due)}</dd>
          </div>
        )}
        {cash > 0 ? (
          <div>
            <dt>Cash for the credit left over</dt>
            <dd>{formatCents(cash)}</dd>
          </div>
        ) : (trade.excessCents ?? 0) > 0 ? (
          <div>
            <dt>Store credit left for you</dt>
            <dd>{formatCents(trade.excessCents ?? 0)}</dd>
          </div>
        ) : null}
      </dl>
      {cash > 0 && <p className="gg-tc-line__meta">We&rsquo;ll be in touch to pay you the cash.</p>}
      {trade.orderId && (
        <Link to={`/account/orders/${trade.orderId}`} className="gg-btn gg-btn-ghost">
          View your order
        </Link>
      )}
      {(trade.excessCents ?? 0) > 0 && cash === 0 && (
        <p className="gg-tc-line__meta">
          Your store credit is ready for your next order. <Link to="/account/credit">See your balance</Link>.
        </p>
      )}
      <ComingBack trade={trade} />
    </section>
  );
}

/** Copies that arrived but that we didn't take, on a finished trade. */
function ComingBack({ trade }: { trade: CustomerTrade }) {
  const cards = trade.offered.filter((c) => copiesToReturn(c) > 0);
  if (cards.length === 0) return null;
  const url = trackingUrlFor(trade.returnCarrier, trade.returnTracking);
  return (
    <div className="gg-tc-settled__back">
      <h3>Coming back to you</h3>
      <ul>
        {cards.map((c) => (
          <li key={c.id}>
            {copiesToReturn(c)} × {cardLine(c)}
          </li>
        ))}
      </ul>
      {trade.returnTracking ? (
        <p className="gg-tc-line__meta">
          {carrierLabel(trade.returnCarrier)} tracking{" "}
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {trade.returnTracking}
            </a>
          ) : (
            <strong>{trade.returnTracking}</strong>
          )}
        </p>
      ) : (
        <p className="gg-tc-line__meta">We&rsquo;ll mail these back and email you when they&rsquo;re on the way.</p>
      )}
    </div>
  );
}

function Returning({ trade }: { trade: CustomerTrade }) {
  const url = trackingUrlFor(trade.returnCarrier, trade.returnTracking);
  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-return-title">
      <h2 id="gg-tc-return-title">{trade.status === "returned" ? "Your cards are on the way back" : "We're returning your cards"}</h2>
      {trade.closeReason && <p>{trade.closeReason}</p>}
      <p>{trade.returnPolicy}</p>
      {trade.returnTracking && (
        <p>
          {carrierLabel(trade.returnCarrier)} tracking{" "}
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {trade.returnTracking}
            </a>
          ) : (
            <strong>{trade.returnTracking}</strong>
          )}
        </p>
      )}
    </section>
  );
}
