import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouter } from "../../lib/router";
import { formatCents } from "../../lib/money";
import { carrierLabel, trackingUrlFor } from "../../lib/tracking";
import { useNow } from "../../lib/useNow";
import { loadTrade, tradeActions, useTradeTerms, type ConfirmResponse, type TradeResponse } from "../../lib/tradeCenterApi";
import { tradeCart, useTradeCart } from "../../lib/tradeCart";
import {
  BLOCKING_ELIGIBILITY,
  CLOSED_TRADE_STATUSES,
  CUSTOMER_CANCELABLE_STATUSES,
  CUSTOMER_EDITABLE_STATUSES,
  CUSTOMER_WITHDRAW_STATUSES,
  MY_TRADES_PATH,
  RESERVED_STATUSES,
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
  tradeShippingTerms,
  tradeStepIndex,
  type CustomerTrade,
  type TradeOfferInput,
  type TradeStatus,
  type TradeWantedInput,
  type TradeWantedItem,
} from "../../lib/tradeCenter";
import { ORDER_STATUS_LABELS, type OrderStatus } from "../../lib/orderStatus";
import { minimumMessage } from "../../lib/tradeShipping";
import { DepositLine, TradeBalance } from "./TradeBalance";
import { TradeShippingProgress } from "./TradeShippingProgress";
import { TradeWantedList, type TradeWantedRow } from "./TradeWantedList";
import { OfferCardsEditor } from "./OfferCardsEditor";
import { TradeConfirmPanel } from "./TradeConfirmPanel";
import { TradeDepositCard } from "./TradeDepositCard";
import { TradeShippingPanel } from "./TradeShippingPanel";
import { TradeProofForm } from "./TradeProofForm";
import { TradeFinalOffer } from "./TradeFinalOffer";
import { TradePaymentPanel } from "./TradePaymentPanel";
import { TradeMessages, TradeTimeline } from "./TradeMessages";

// Account → Trades → one trade: everything about it in one place, changing
// with where it stands. While the customer builds their list: our cards
// (still on sale: nothing is reserved yet), their cards (search, paste or
// CSV, each priced by the server), the running total, and "Send for
// review" (once our cards reach the trade minimum; the bar under our cards
// shows how far they are from it and from free shipping). Then the review,
// the confirmation (with the refundable deposit when there is one), the
// shipping deadline and tracking, the inspection, the final offer and its
// answer, the payment (any of our cards the credit doesn't cover, and
// shipping them), how it all settled and our cards on their way; or, for a
// trade that stopped, why, and what happens to the deposit and any cards
// that reached us. Messages and history all the way through.

const ESTIMATED: ReadonlySet<TradeStatus> = new Set(["awaiting_trade_list", "revision_requested", "pending_review"]);
const APPROVED: ReadonlySet<TradeStatus> = new Set([
  "awaiting_confirmation",
  "awaiting_deposit",
  "awaiting_shipment",
  "tracking_submitted",
  "in_transit",
  "received",
  "under_inspection",
]);
const CONFIRMING: ReadonlySet<TradeStatus> = new Set(["awaiting_confirmation", "awaiting_deposit"]);
const SHIPPING: ReadonlySet<TradeStatus> = new Set(["awaiting_shipment", "tracking_submitted", "in_transit"]);
/** Reload when the customer comes back to the tab after this long (a scan or a decision may have landed). */
const STALE_MS = 60_000;

type Flash = { tone: "ok" | "warn" | "error"; text: string } | null;

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** What to tell the customer once their deposit payment is back from Stripe. */
function afterDeposit(trade: CustomerTrade, paymentStatus: string | undefined): Flash {
  if (trade.status === "awaiting_shipment") {
    return {
      tone: "ok",
      text: `Deposit paid. Our cards are reserved for you${trade.shipBy ? `: ship by ${formatDeadline(trade.shipBy)}` : ""}.`,
    };
  }
  if (trade.status === "revision_requested") {
    return {
      tone: "warn",
      text: "Some of our cards sold just before your deposit went through. Nothing was reserved, and your deposit is being refunded in full. Update your selection and send the trade again.",
    };
  }
  if (CLOSED_TRADE_STATUSES.has(trade.status) && paymentStatus === "succeeded") {
    return { tone: "warn", text: "Your deposit came through after this trade closed, so it's being refunded in full." };
  }
  if (paymentStatus === "processing") {
    return { tone: "ok", text: "Your deposit is processing. We'll reserve our cards the moment it goes through, and email you." };
  }
  if (paymentStatus === "succeeded") return { tone: "ok", text: "Deposit received. Refresh in a moment to see your reservation." };
  return { tone: "error", text: "The deposit payment didn't go through. Try again, or use a different card." };
}

export default function TradeDetail({ tradeId }: { tradeId: string }) {
  const { query, navigate } = useRouter();
  const terms = useTradeTerms();
  const cart = useTradeCart();
  const [trade, setTrade] = useState<CustomerTrade | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showDeclineFromPayment, setShowDeclineFromPayment] = useState(false);
  const paymentChecked = useRef(false);
  const loadedAt = useRef(0);
  const now = useNow();

  const show = useCallback((next: CustomerTrade) => {
    loadedAt.current = Date.now();
    setTrade(next);
  }, []);

  const reload = useCallback(async () => {
    try {
      show((await loadTrade(tradeId)).trade);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, "We couldn't load this trade."));
    }
  }, [tradeId, show]);

  useEffect(() => {
    let cancelled = false;
    loadTrade(tradeId)
      .then((res) => {
        if (!cancelled) show(res.trade);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err, "We couldn't load this trade."));
      });
    return () => {
      cancelled = true;
    };
  }, [tradeId, show]);

  // Back on the tab (or the installed app) after a while: the carrier may have
  // scanned the package, or we may have answered.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && loadedAt.current > 0 && Date.now() - loadedAt.current > STALE_MS && !busy) {
        void reload();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload, busy]);

  // Back from a bank check during a card payment: pick the payment up (the
  // deposit or the rest of the trade, whichever page sent them).
  const returnedIntent = query.get("payment_intent");
  const returnedKind = query.get("pay");
  useEffect(() => {
    if (!returnedIntent || paymentChecked.current) return;
    paymentChecked.current = true;
    const deposit = returnedKind === "deposit";
    const check = deposit ? tradeActions.confirmDeposit(tradeId, returnedIntent) : tradeActions.confirmPayment(tradeId, returnedIntent);
    check
      .then((res) => {
        show(res.trade);
        if (deposit) setFlash(afterDeposit(res.trade, res.paymentStatus));
        else if (res.paymentStatus === "succeeded") setFlash({ tone: "ok", text: "Payment received. Your trade is complete!" });
        else if (res.paymentStatus === "processing") setFlash({ tone: "ok", text: "Your payment is processing. We'll email you when it goes through." });
        else setFlash({ tone: "error", text: "The payment didn't go through. Try again, or use a different card." });
      })
      .catch((err: unknown) => setFlash({ tone: "error", text: errorText(err, "We couldn't check your payment.") }))
      .finally(() => navigate(window.location.pathname, { replace: true }));
  }, [returnedIntent, returnedKind, tradeId, navigate, show]);

  async function run(label: string, fn: () => Promise<TradeResponse>, done?: string): Promise<boolean> {
    setBusy(label);
    setFlash(null);
    try {
      const res = await fn();
      show(res.trade);
      if (done) setFlash({ tone: "ok", text: done });
      return true;
    } catch (err) {
      setFlash({ tone: "error", text: errorText(err, "Something went wrong. Try again.") });
      void reload();
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function confirmTrade(termsVersion: number): Promise<ConfirmResponse | null> {
    setBusy("confirm");
    setFlash(null);
    try {
      const res = await tradeActions.confirm(tradeId, termsVersion);
      show(res.trade);
      if (res.notice) setFlash({ tone: "warn", text: res.notice });
      else if (res.trade.status === "awaiting_shipment") {
        setFlash({
          tone: "ok",
          text: `Confirmed! Our cards are reserved for you${res.trade.shipBy ? `: ship by ${formatDeadline(res.trade.shipBy)}` : ""}.`,
        });
      }
      return res;
    } catch (err) {
      setFlash({ tone: "error", text: errorText(err, "We couldn't confirm your trade. Try again.") });
      void reload();
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function depositPaid(paymentIntentId: string): Promise<void> {
    setBusy("deposit");
    setFlash(null);
    try {
      const res = await tradeActions.confirmDeposit(tradeId, paymentIntentId);
      show(res.trade);
      setFlash(afterDeposit(res.trade, res.paymentStatus));
    } catch (err) {
      setFlash({ tone: "error", text: errorText(err, "We couldn't check your deposit. Refresh in a minute.") });
      void reload();
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
  const closed = CLOSED_TRADE_STATUSES.has(status);
  const finished = status === "approved_for_fulfillment" || status === "completed";
  const reserved = RESERVED_STATUSES.includes(status);
  const onTrade = trade.wanted.filter((w) => w.status === "requested" || w.status === "reserved" || w.status === "fulfilled");
  const wantedInputs: TradeWantedInput[] = onTrade
    .filter((w) => w.inventoryItemId)
    .map((w) => ({ inventoryItemId: w.inventoryItemId as string, quantity: w.quantity }));
  const fromCart = cart.filter((c) => !onTrade.some((w) => w.inventoryItemId === c.inventoryItemId));
  const blocked = trade.offered.filter((c) => BLOCKING_ELIGIBILITY.has(c.eligibility));
  const shortLines = onTrade.filter((w) => w.status === "requested" && w.available !== null && w.available < w.quantity);
  const valueLabel = ESTIMATED.has(status) ? "estimated" : APPROVED.has(status) ? "approved" : "final";
  const value =
    valueLabel === "estimated" ? trade.estimatedValueCents : valueLabel === "approved" ? (trade.approvedValueCents ?? 0) : (trade.finalValueCents ?? 0);
  const step = tradeStepIndex(status);
  const shippingTerms = tradeShippingTerms(trade);
  const minTradeValueCents = terms?.minTradeValueCents ?? 0;
  const belowMinimum = trade.wantedTotalCents < minTradeValueCents;
  const lastWord = [...trade.messages].reverse().find((m) => m.authorType === "staff" || m.authorType === "system");
  const listDue = trade.listDueAt ? Date.parse(trade.listDueAt) : null;

  const wantedRows: TradeWantedRow[] = trade.wanted
    .filter((w) => w.status !== "removed" || !editable)
    .map((w) => ({
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
      maxQuantity: editable && w.available !== null ? Math.max(w.available, 1) : undefined,
      released: w.status === "released" || w.status === "removed",
      ...lineNote(w, editable),
    }));

  const setWanted = (items: TradeWantedInput[], done?: string) => run("wanted", () => tradeActions.setWanted(tradeId, items), done);
  const saveOffer = (cards: TradeOfferInput[]) => run("offer", () => tradeActions.saveOffer(tradeId, cards));

  const submitProblems = [
    ...(trade.offered.length === 0 ? ["Add the cards you're trading in."] : []),
    ...(blocked.length > 0 ? [`Take off the ${blocked.length === 1 ? "card" : `${blocked.length} cards`} we can't accept.`] : []),
    ...(onTrade.length === 0 ? ["Add at least one of our cards."] : []),
    ...(onTrade.length > 0 && belowMinimum ? [minimumMessage(trade.wantedTotalCents, minTradeValueCents)] : []),
    ...(shortLines.length > 0
      ? [`${shortLines.length === 1 ? "One of our cards has" : `${shortLines.length} of our cards have`} fewer copies left than you picked.`]
      : []),
  ];

  const oursIntro = editable
    ? "These stay on sale until you confirm your approved trade, so they aren't reserved yet. Prices are our regular prices, set when each card was added."
    : status === "pending_review" || CONFIRMING.has(status)
      ? `Not reserved yet: they stay on sale until you confirm${trade.deposit.cents > 0 ? " and pay the deposit" : ""}.`
      : status === "awaiting_shipment" || status === "tracking_submitted"
        ? "Reserved for you while you ship your cards."
        : reserved
          ? "Reserved for you until your trade is settled."
          : finished
            ? "On your order."
            : null;

  return (
    <div className="gg-tc-detail">
      <header className="gg-tc-head">
        <div>
          <p className="gg-tc-head__id">Trade {tradeLabel(trade.tradeNumber)}</p>
          <h2 className="gg-tc-head__status">{TRADE_STATUS_LABELS[status]}</h2>
          <p className="gg-tc-head__next">{TRADE_STATUS_NEXT[status]}</p>
          {editable && listDue !== null && (
            <p className={now > listDue ? "gg-tc-deadline gg-tc-deadline--past" : "gg-tc-deadline"}>
              {now > listDue ? (
                <>The time to send this trade ran out at {formatDeadline(trade.listDueAt as string)}.</>
              ) : (
                <>
                  {status === "revision_requested" ? "Send your changes by" : "Send it for review by"}{" "}
                  <strong>{formatDeadline(trade.listDueAt as string)}</strong> ({timeLeft(listDue, now)} left), or it closes.
                </>
              )}
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

      {flash && (
        <p
          className={`gg-alert ${flash.tone === "ok" ? "gg-alert-ok" : flash.tone === "warn" ? "gg-alert-warn" : "gg-alert-error"}`}
          role={flash.tone === "error" ? "alert" : "status"}
        >
          {flash.text}
        </p>
      )}

      {status === "revision_requested" && lastWord && (
        <div className="gg-tc-ask">
          <h3>{lastWord.authorType === "system" ? "Some of our cards sold" : "What we need changed"}</h3>
          <p>{lastWord.body}</p>
        </div>
      )}

      {closed && !finished && (
        <ClosedPanel
          trade={trade}
          busy={busy}
          onProof={(text, files) =>
            run("proof", () => tradeActions.proof(tradeId, text, files), "Thanks. A person will look at your proof of shipping and email you.")
          }
        />
      )}

      <div className="gg-tc-grid">
        <div className="gg-tc-main">
          {CONFIRMING.has(status) && (
            <TradeConfirmPanel
              trade={trade}
              busy={busy === "confirm" || busy === "deposit"}
              askBusy={busy === "ask"}
              onConfirm={confirmTrade}
              onDepositPaid={depositPaid}
              onAskForTime={(text) => run("ask", () => tradeActions.askForTime(tradeId, text), "Sent. We'll reply in your messages.")}
            />
          )}

          {SHIPPING.has(status) && (
            <TradeShippingPanel
              trade={trade}
              terms={terms}
              busy={busy}
              onTracking={(shipment) =>
                run(
                  "tracking",
                  () => tradeActions.tracking(tradeId, shipment),
                  shipment.trackingNumber === trade.shipment.tracking
                    ? "Saved."
                    : "Thanks! Your shipment counts as soon as the carrier scans your package.",
                )
              }
              onProof={(text, files) =>
                run("proof", () => tradeActions.proof(tradeId, text, files), "Thanks. A person will look at your proof of shipping and email you.")
              }
              onAskForTime={(text) => run("ask", () => tradeActions.askForTime(tradeId, text), "Sent. We'll reply in your messages.")}
            />
          )}

          {(status === "received" || status === "under_inspection") && <Inspecting trade={trade} />}

          {!CONFIRMING.has(status) && <TradeDepositCard trade={trade} />}

          {status === "awaiting_final_approval" && (
            <TradeFinalOffer
              trade={trade}
              busy={busy === "answer"}
              onAccept={(shipTo) => run("answer", () => tradeActions.accept(tradeId, shipTo))}
              onAdjust={(message) => run("answer", () => tradeActions.adjust(tradeId, message), "Sent. We'll take another look and reply here.")}
              onDecline={(reason) => run("answer", () => tradeActions.decline(tradeId, reason), "Declined. We'll mail your cards back.")}
            />
          )}

          {status === "awaiting_payment" && (
            <>
              <TradePaymentPanel
                trade={trade}
                onStart={async () => {
                  setFlash(null);
                  try {
                    const res = await tradeActions.pay(tradeId);
                    if ("paid" in res) {
                      show(res.trade);
                      return null;
                    }
                    return res;
                  } catch (err) {
                    setFlash({ tone: "error", text: errorText(err, "We couldn't start the payment.") });
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
                  <p>There&rsquo;s no penalty for declining, and it never affects your deposit.</p>
                  <p>{trade.returnPolicy}</p>
                  <div className="gg-tc-pick__actions">
                    <button
                      type="button"
                      className="gg-btn gg-tc-btn-danger"
                      disabled={busy !== null}
                      onClick={() => void run("answer", () => tradeActions.decline(tradeId, null), "Declined. We'll mail your cards back.")}
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

          <section className="gg-tc-panel" aria-labelledby="gg-tc-ours-title">
            <h2 id="gg-tc-ours-title">Our cards</h2>
            {oursIntro && <p className="gg-tc-line__meta">{oursIntro}</p>}
            <TradeWantedList
              rows={wantedRows}
              busy={busy === "wanted"}
              onQuantity={
                editable
                  ? (key, quantity) => {
                      const item = onTrade.find((w) => w.id === key);
                      if (item) void setWanted(wantedInputs.map((i) => (i.inventoryItemId === item.inventoryItemId ? { ...i, quantity } : i)));
                    }
                  : undefined
              }
              onRemove={
                editable && onTrade.length > 1
                  ? (key) => {
                      const item = onTrade.find((w) => w.id === key);
                      if (item) void setWanted(wantedInputs.filter((i) => i.inventoryItemId !== item.inventoryItemId));
                    }
                  : undefined
              }
            />
            {editable && (
              <TradeShippingProgress wantedCents={trade.wantedTotalCents} terms={{ ...shippingTerms, minTradeValueCents }} />
            )}
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
                      "Added to your trade.",
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

        {!finished && !closed && (
          <aside className="gg-tc-aside">
            <TradeBalance
              wantedCents={trade.wantedTotalCents}
              offeredValueCents={value}
              valueLabel={valueLabel}
              ratePercent={trade.creditRatePercent}
              feeCents={trade.processingFeeCents}
              shipping={shippingTerms}
              shippingCents={trade.shippingCents ?? undefined}
              canAddCards={editable}
              deposit={<DepositLine trade={trade} />}
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
                    void run("submit", () => tradeActions.submit(tradeId, note.trim() || null), "Sent! We'll email you when we've reviewed your trade.");
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
                  <p className="gg-tc-line__meta">
                    Don&rsquo;t mail anything yet. Once we approve your trade you&rsquo;ll confirm it, and then we&rsquo;ll tell you where to send
                    your cards.
                  </p>
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
          <CancelTrade
            trade={trade}
            busy={busy === "cancel"}
            onCancel={(reason, acceptDepositReview) =>
              run("cancel", () => tradeActions.cancel(tradeId, reason, acceptDepositReview), "Your trade is canceled.")
            }
            onWithdraw={(reason) => run("cancel", () => tradeActions.withdraw(tradeId, reason), "Canceled. We'll mail your cards back.")}
          />
        </div>
      </div>
    </div>
  );
}

/** A word on one of our cards: how many are left, or why it's off the trade. */
function lineNote(w: TradeWantedItem, editable: boolean): Pick<TradeWantedRow, "note" | "noteTone"> {
  if (w.status === "released") return { note: "Released back to the shop", noteTone: "muted" };
  if (w.status === "removed") return { note: "Taken off this trade", noteTone: "muted" };
  if (w.status !== "requested" || w.available === null || w.available >= w.quantity) return {};
  if (w.available === 0) {
    return { note: editable ? "Sold out: take it off or choose another copy" : "Sold since you added it", noteTone: "warn" };
  }
  return { note: `Only ${w.available} left${editable ? ": lower the quantity" : ""}`, noteTone: "warn" };
}

/** Their package reached us: what happens while we inspect. */
function Inspecting({ trade }: { trade: CustomerTrade }) {
  const delivered = trade.shipment.deliveredAt;
  return (
    <section className="gg-tc-panel" aria-labelledby="gg-tc-inspect-title">
      <h2 id="gg-tc-inspect-title">{trade.status === "received" ? "Your cards arrived" : "We're inspecting your cards"}</h2>
      <p>
        {delivered ? `Delivered ${formatDeadline(delivered)}. ` : ""}We check each card&rsquo;s printing, condition and authenticity, then email you
        the final offer. Our cards stay reserved for you meanwhile.
      </p>
      <p className="gg-tc-line__meta">
        If anything comes out different from what we approved, the offer shows each change and why, and you can decline with no penalty.
      </p>
    </section>
  );
}

const EXPIRED_STAGE_TEXT: Record<string, string> = {
  draft: "This trade wasn't sent for review in time, so it closed.",
  revision: "Your changes weren't sent in time, so this trade closed.",
  confirmation: "This trade wasn't confirmed in time, so it closed.",
  deposit: "The deposit wasn't paid in time, so this trade closed.",
};

/** A trade that stopped: why, what happens to any cards that reached us, and proof of shipping for an expired reservation. */
function ClosedPanel({
  trade,
  busy,
  onProof,
}: {
  trade: CustomerTrade;
  busy: string | null;
  onProof: (note: string, files: File[]) => Promise<boolean>;
}) {
  const status = trade.status;
  let heading: string;
  let body: string;
  switch (status) {
    case "rejected":
      heading = "We couldn't accept this trade";
      body = trade.closeReason ?? "Thanks for offering it. You're welcome to start a new trade.";
      break;
    case "offer_expired":
      heading = "This trade closed";
      body = `${EXPIRED_STAGE_TEXT[trade.expiredStage ?? ""] ?? TRADE_STATUS_NEXT.offer_expired} Nothing was reserved or charged for it.`;
      break;
    case "canceled":
      heading = "You canceled this trade";
      body = trade.closeReason ? `Your reason: ${trade.closeReason}` : "Our cards went back on sale.";
      break;
    case "expired":
      heading = "Your reservation expired";
      body =
        trade.expiredStage === "scan"
          ? `The carrier hadn't scanned your package by the shipping deadline${trade.shipBy ? ` (${formatDeadline(trade.shipBy)})` : ""}, so our cards went back on sale.`
          : `No tracking number was added by the shipping deadline${trade.shipBy ? ` (${formatDeadline(trade.shipBy)})` : ""}, so our cards went back on sale.`;
      break;
    case "canceled_after_shipment":
      heading = "You canceled after shipping";
      body = "There's no penalty for that. Your cards come back to you.";
      break;
    case "declined_after_inspection":
      heading = "You declined the final offer";
      body = "There's no penalty for that. Your cards come back to you.";
      break;
    case "canceled_by_store":
      heading = "We canceled this trade";
      body = `${trade.closeReason ? `${trade.closeReason} ` : ""}Any deposit you paid is refunded in full.`;
      break;
    default:
      heading = TRADE_STATUS_LABELS[status];
      body = TRADE_STATUS_NEXT[status];
  }
  return (
    <div className="gg-tc-panel gg-tc-closed">
      <h2>{heading}</h2>
      <p>{body}</p>
      {status === "expired" && (
        <>
          <p className="gg-tc-line__meta">If your package reaches us anyway, we&rsquo;ll be in touch about it.</p>
          <TradeProofForm trade={trade} busy={busy === "proof"} onSend={onProof} />
        </>
      )}
      {trade.returnStatus !== "none" && <Returning trade={trade} />}
      <Link to={TRADE_CENTER_PATH} className="gg-btn gg-btn-ghost">
        Start a new trade
      </Link>
    </div>
  );
}

/** Cancel before shipping (a paid deposit goes to review first), or withdraw after the carrier has the package (no penalty). */
function CancelTrade({
  trade,
  busy,
  onCancel,
  onWithdraw,
}: {
  trade: CustomerTrade;
  busy: boolean;
  onCancel: (reason: string | null, acceptDepositReview: boolean) => Promise<boolean>;
  onWithdraw: (reason: string | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [reason, setReason] = useState("");
  const status = trade.status;
  const canCancel = CUSTOMER_CANCELABLE_STATUSES.includes(status);
  const canWithdraw = CUSTOMER_WITHDRAW_STATUSES.includes(status);

  if (!canCancel && !canWithdraw) {
    if (status === "tracking_submitted") {
      return (
        <p className="gg-tc-cancel gg-tc-line__meta">
          Need to cancel? Your tracking number is on file, so send us a message and we&rsquo;ll sort it out.
        </p>
      );
    }
    return null;
  }

  const d = trade.deposit;
  const depositAtRisk = status === "awaiting_shipment" && d.status === "paid";
  const depositBack = canWithdraw && (d.status === "paid" || d.status === "forfeiture_review");
  let explanation: string;
  if (canWithdraw) {
    explanation = `There's no penalty for canceling once the carrier has your package: we'll mail your cards back${depositBack ? ", and your deposit is refunded in full" : ""}.`;
  } else if (status === "awaiting_shipment") {
    explanation = depositAtRisk
      ? `Our cards are reserved for you. Canceling now, before you ship, means your ${formatCents(d.paidCents ?? d.cents)} deposit may be kept under the cancellation terms you agreed to; a person reviews every case first. It also counts against future trades.`
      : "Our cards are reserved for you and go back on sale if you cancel. Canceling after confirming counts against future trades, and may mean a deposit next time.";
  } else if (status === "awaiting_deposit") {
    explanation = "Your deposit hasn't been paid, so canceling costs nothing. Our cards stay on sale.";
  } else {
    explanation = "Nothing is reserved or charged yet, so canceling costs nothing.";
  }

  if (!open) {
    return (
      <div className="gg-tc-cancel">
        <button type="button" className="gg-linkbtn" onClick={() => setOpen(true)}>
          {canWithdraw ? "Cancel and get my cards back" : "Cancel this trade"}
        </button>
      </div>
    );
  }

  return (
    <form
      className="gg-tc-cancel gg-tc-subform gg-tc-subform--warn"
      onSubmit={async (e) => {
        e.preventDefault();
        if (depositAtRisk && !understood) return;
        const why = reason.trim() || null;
        const ok = canWithdraw ? await onWithdraw(why) : await onCancel(why, depositAtRisk && understood);
        if (ok) setOpen(false);
      }}
    >
      <h3>{canWithdraw ? "Cancel and get your cards back?" : "Cancel this trade?"}</h3>
      <p>{explanation}</p>
      {canWithdraw && trade.returnPolicy && <p>{trade.returnPolicy}</p>}
      {depositAtRisk && (
        <label className="gg-tc-ack">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>I understand my deposit may be kept under the cancellation terms I agreed to.</span>
        </label>
      )}
      <label className="gg-field">
        <span>Why are you canceling? (optional)</span>
        <textarea rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className="gg-tc-line__meta">This can&rsquo;t be undone.</p>
      <div className="gg-tc-pick__actions">
        <button type="submit" className="gg-btn gg-tc-btn-danger" disabled={busy || (depositAtRisk && !understood)}>
          {busy ? "Canceling…" : canWithdraw ? "Cancel and return my cards" : "Yes, cancel my trade"}
        </button>
        <button type="button" className="gg-linkbtn" onClick={() => setOpen(false)} disabled={busy}>
          Keep my trade
        </button>
      </div>
    </form>
  );
}

function Settled({ trade }: { trade: CustomerTrade }) {
  const due = trade.amountDueCents ?? 0;
  const shipping = trade.shippingCents ?? 0;
  const shippingPaid = Math.min(shipping, due);
  const cardsPaid = due - shippingPaid;
  const credit = trade.creditIssuedCents ?? trade.finalCreditCents ?? 0;
  const creditOnCards = Math.min(credit, trade.wantedTotalCents);
  const cash = trade.excessHandling === "cash" ? (trade.cashPayoutCents ?? 0) : 0;
  return (
    <section className="gg-tc-panel gg-tc-settled" aria-labelledby="gg-tc-settled-title">
      <h2 id="gg-tc-settled-title">How your trade settled</h2>
      <dl className="gg-tc-balance__rows">
        <div>
          <dt>Our cards</dt>
          <dd>{formatCents(trade.wantedTotalCents)}</dd>
        </div>
        {trade.finalValueCents != null && (
          <div>
            <dt>Your cards (final value)</dt>
            <dd>{formatCents(trade.finalValueCents)}</dd>
          </div>
        )}
        <div className="gg-tc-balance__credit">
          <dt>Trade credit issued at {trade.creditRatePercent}%</dt>
          <dd>{formatCents(credit)}</dd>
        </div>
        <div>
          <dt>Credit used on our cards</dt>
          <dd>{formatCents(creditOnCards)}</dd>
        </div>
        {cardsPaid > 0 && (
          <div>
            <dt>Paid by card for our cards</dt>
            <dd>{formatCents(cardsPaid)}</dd>
          </div>
        )}
        <div>
          <dt>Shipping our cards to you</dt>
          <dd>{shipping > 0 ? `${formatCents(shippingPaid)} paid by card` : "FREE"}</dd>
        </div>
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
      <DepositLine trade={trade} />
      {cash > 0 && <p className="gg-tc-line__meta">We&rsquo;ll be in touch to pay you the cash.</p>}
      <OutgoingShipment trade={trade} />
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

/** Our cards on their way to the customer: the trade's order, its status and tracking. */
function OutgoingShipment({ trade }: { trade: CustomerTrade }) {
  const o = trade.outgoing;
  const to = trade.shipTo;
  const where = to ? [to.name, `${to.city}, ${to.state}`].filter(Boolean).join(", ") : null;
  if (!o) {
    return (
      <div className="gg-tc-outgoing">
        <h3>We&rsquo;re packing your new cards</h3>
        <p className="gg-tc-line__meta">
          They ship with tracking{where ? ` to ${where}` : ""}, and we&rsquo;ll email you the tracking number.
        </p>
      </div>
    );
  }
  const status = o.status as OrderStatus;
  const halted = status === "cancelled" || status === "refunded";
  const delivered = status === "delivered" || o.deliveredAt !== null;
  const shipped = delivered || status === "shipped" || o.shippedAt !== null;
  const url = trackingUrlFor(o.carrier, o.tracking);
  const heading = halted
    ? `Your order was ${(ORDER_STATUS_LABELS[status] ?? o.status).toLowerCase()}`
    : delivered
      ? "Your new cards were delivered"
      : shipped
        ? "Your new cards are on the way"
        : "We're packing your new cards";
  return (
    <div className="gg-tc-outgoing">
      <h3>{heading}</h3>
      {o.tracking ? (
        <p>
          {carrierLabel(o.carrier)} tracking{" "}
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {o.tracking}
            </a>
          ) : (
            <strong>{o.tracking}</strong>
          )}
          {o.shippedAt ? <span className="gg-tc-line__meta"> · shipped {formatDeadline(o.shippedAt)}</span> : null}
          {o.deliveredAt ? <span className="gg-tc-line__meta"> · delivered {formatDeadline(o.deliveredAt)}</span> : null}
        </p>
      ) : halted ? (
        <p className="gg-tc-line__meta">Questions? Send us a message below.</p>
      ) : (
        <p className="gg-tc-line__meta">
          They ship with tracking{where ? ` to ${where}` : ""}, and we&rsquo;ll email you the tracking number.
        </p>
      )}
    </div>
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

/** Their cards on the way back to them, on a trade that closed after they shipped. */
function Returning({ trade }: { trade: CustomerTrade }) {
  const url = trackingUrlFor(trade.returnCarrier, trade.returnTracking);
  const returned = trade.returnStatus === "returned";
  return (
    <div className="gg-tc-return">
      <h3>{returned ? "Your cards are on the way back" : "We're mailing your cards back"}</h3>
      {!returned && trade.returnPolicy && <p>{trade.returnPolicy}</p>}
      {trade.returnTracking ? (
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
      ) : (
        <p className="gg-tc-line__meta">We&rsquo;ll email you the tracking number when they ship.</p>
      )}
    </div>
  );
}
