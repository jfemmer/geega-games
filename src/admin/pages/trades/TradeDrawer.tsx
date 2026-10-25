import { useCallback, useEffect, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TextArea, TextField } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { ErrorState, Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime } from "../../utils/format";
import { tradeCenterRepository, type TradeDetailResult } from "../../repositories/tradeCenter.supabase";
import { carrierLabel, trackingUrlFor } from "../../../store/lib/tracking";
import { useNow } from "../../../store/lib/useNow";
import {
  CONDITION_NAMES,
  FINISH_NAMES,
  PRE_SHIPMENT_STATUSES,
  STAFF_REJECTABLE_STATUSES,
  STAFF_WANTED_STATUSES,
  TRADE_STATUS_ADMIN_LABELS,
  formatDeadline,
  timeLeft,
  tradeLabel,
  type StaffTrade,
  type StaffTradeOfferCard,
  type TradeSettings,
  type TradeStatus,
} from "../../../store/lib/tradeCenter";
import { TRADE_STATUS_TONE } from "./tradeLabels";
import { pendingAdjustment, quantityOptions, tradeMoney } from "./tradeMath";
import { CardThumb, OfferCardHead } from "./TradeCardBits";
import { TradeReviewPanel } from "./TradeReviewPanel";
import { TradeInspectionPanel } from "./TradeInspectionPanel";
import { TradeWrapUpPanel } from "./TradeWrapUpPanel";
import { TradeHistory, TradeMessagesPanel } from "./TradeConversation";
import type { TradePanelProps } from "./types";

// One online trade, everything staff do with it, changing with where it
// stands: the customer and deadlines, what it adds up to, the step that's
// waiting (review, receiving, inspection and the final offer, payment,
// wrapping up), our cards on it, messages, history, and rejecting it.

/** What staff do next, by status. */
const STAFF_NEXT: Record<TradeStatus, string> = {
  awaiting_trade_list: "The customer is still adding their cards. Nothing to do yet.",
  pending_review: "Review each card below, then approve the trade, ask for changes, or reject it.",
  revision_requested: "Waiting for the customer to change their list.",
  awaiting_shipment: "Approved. Waiting for the customer to mail their cards and add tracking.",
  in_transit: "On its way to you. Mark it received when it arrives.",
  received: "The package is here. Inspect the cards below.",
  under_inspection: "Finish inspecting, then send the final offer.",
  awaiting_final_approval: "Final offer sent. Waiting for the customer to accept it, ask for an adjustment, or decline.",
  awaiting_payment: "Accepted. Waiting for the customer to pay the difference by card.",
  approved_for_fulfillment: "Finished. Pack and ship their order, and add the cards you took to inventory.",
  completed: "Complete: their order shipped.",
  rejected: "Closed. Our cards were released.",
  canceled: "Canceled. Our cards were released.",
  expired: "Expired. Our cards were released.",
  return_pending: "Mail their cards back, then mark them returned.",
  returned: "Closed. Their cards were mailed back.",
};

const EXTEND_OPTIONS = [
  { hours: 24, label: "1 day" },
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
];

interface Loaded {
  trade: StaffTrade;
  settings: TradeSettings;
  /** The signed-in staff member is the store owner (from the latest response). */
  owner: boolean;
}

interface DrawerProps {
  tradeId: string | null;
  onClose: () => void;
  /** After any change, so the list can refresh. */
  onChanged: () => void;
  onOpenOrder: (orderId: string) => void;
}

export function TradeDrawer(props: DrawerProps) {
  // A fresh drawer per trade: nothing from the last one carries over.
  if (!props.tradeId) return null;
  return <OpenTradeDrawer key={props.tradeId} {...props} tradeId={props.tradeId} />;
}

function OpenTradeDrawer({ tradeId, onClose, onChanged, onOpenOrder }: DrawerProps & { tradeId: string }) {
  const toast = useToast();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    tradeCenterRepository.get(tradeId).then(
      (result) => {
        if (active) setLoaded({ trade: result.trade, settings: result.settings, owner: result.owner });
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load the trade.");
      },
    );
    return () => {
      active = false;
    };
  }, [tradeId, attempt]);

  const run = useCallback<TradePanelProps["run"]>(
    async (key, action, done) => {
      setBusy(key);
      try {
        const result: TradeDetailResult = await action();
        setLoaded({ trade: result.trade, settings: result.settings, owner: result.owner });
        toast.success(done);
        onChanged();
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "That didn't work. Try again.");
        // Part of it may have gone through (a review saved before an approval failed).
        tradeCenterRepository.get(tradeId).then(
          (result) => setLoaded({ trade: result.trade, settings: result.settings, owner: result.owner }),
          () => undefined,
        );
        onChanged();
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast, onChanged, tradeId],
  );

  const trade = loaded?.trade ?? null;
  return (
    <Modal
      open
      onClose={onClose}
      // A non-breaking hyphen keeps "TR-1001" on one line beside the status.
      title={trade ? `Trade ${tradeLabel(trade.tradeNumber).replace("-", "\u2011")}` : "Trade"}
      variant="drawer"
      size="lg"
      headerExtra={trade ? <Badge tone={TRADE_STATUS_TONE[trade.status]}>{TRADE_STATUS_ADMIN_LABELS[trade.status]}</Badge> : null}
    >
      {loaded ? (
        <TradeBody
          trade={loaded.trade}
          settings={loaded.settings}
          owner={loaded.owner}
          busy={busy}
          run={run}
          onOpenOrder={onOpenOrder}
        />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <div className="gg-sortdetail__loading">
          <Spinner label="Loading the trade" />
        </div>
      )}
    </Modal>
  );
}

function TradeBody(props: TradePanelProps & { onOpenOrder: (orderId: string) => void }) {
  const { trade, settings, busy, run, onOpenOrder } = props;
  const status = trade.status;
  const showReview = status === "pending_review";
  const showInspection = status === "received" || status === "under_inspection";
  const showWrapUp = status === "approved_for_fulfillment" || status === "completed" || status === "return_pending" || status === "returned";

  return (
    <div className="gg-trd">
      <CustomerSection trade={trade} />
      <StandingSection {...props} />
      <MoneySection trade={trade} />

      {showReview && <TradeReviewPanel {...props} />}
      {showInspection && <TradeInspectionPanel {...props} />}
      {(status === "awaiting_shipment" || status === "in_transit") && <ReceivePanel {...props} />}
      {status === "awaiting_final_approval" && <FinalOfferSentPanel {...props} />}
      {status === "awaiting_payment" && <PaymentPanel {...props} />}
      {showWrapUp && <TradeWrapUpPanel {...props} onOpenOrder={onOpenOrder} />}

      {!showReview && !showInspection && <TheirCards trade={trade} />}
      <OurCards trade={trade} busy={busy} run={run} />
      <TradeMessagesPanel trade={trade} busy={busy} run={run} />
      <TradeHistory trade={trade} />
      {STAFF_REJECTABLE_STATUSES.includes(status) && status !== "pending_review" && (
        <RejectSection trade={trade} settings={settings} busy={busy} run={run} owner={props.owner} />
      )}
    </div>
  );
}

function CustomerSection({ trade }: { trade: StaffTrade }) {
  const subject = encodeURIComponent(`Your Geega Games trade ${tradeLabel(trade.tradeNumber)}`);
  return (
    <section className="gg-trd__section">
      <h3>Customer</h3>
      <p>
        <strong>{trade.customerName || "Customer"}</strong>
      </p>
      {trade.customerEmail && (
        <div className="gg-leaddetail__contactlinks">
          <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`mailto:${trade.customerEmail}?subject=${subject}`}>
            <Icon name="mail" size={14} /> {trade.customerEmail}
          </a>
        </div>
      )}
      <p className="gg-card-meta">
        Started {formatDateTime(trade.createdAt)}
        {trade.submittedAt ? ` · sent for review ${formatDateTime(trade.submittedAt)}` : ""}
      </p>
      {trade.customerNote && <p className="gg-trd-card__quote">Their note: &ldquo;{trade.customerNote}&rdquo;</p>}
    </section>
  );
}

/** Where it stands: what staff do next, the deadline (and more time), tracking, conditions, why it closed. */
function StandingSection({ trade, busy, run }: TradePanelProps) {
  const [hours, setHours] = useState(48);
  const status = trade.status;
  const deadline =
    status === "awaiting_trade_list" || status === "revision_requested"
      ? { label: status === "revision_requested" ? "Changes due" : "List due", at: trade.holdExpiresAt }
      : status === "awaiting_shipment"
        ? { label: "Ship by", at: trade.shipBy }
        : status === "awaiting_payment"
          ? { label: "Payment due", at: trade.paymentDueAt }
          : null;
  const trackingUrl = trackingUrlFor(trade.inboundCarrier, trade.inboundTracking);
  const now = useNow();

  return (
    <section className="gg-trd__section gg-trd-standing">
      <p className="gg-trd-standing__next">
        <Icon name={status === "pending_review" || status === "received" || status === "under_inspection" || status === "return_pending" ? "alert" : "info"} size={16} />
        {STAFF_NEXT[status]}
      </p>
      {deadline?.at && (
        <div className="gg-trd-deadline">
          <span>
            <strong>{deadline.label}:</strong> {formatDeadline(deadline.at)}{" "}
            <span className="gg-card-meta">
              ({Date.parse(deadline.at) > now ? `${timeLeft(Date.parse(deadline.at), now)} left` : "past due"})
            </span>
          </span>
          {status === "awaiting_shipment" && trade.holdExpiresAt && (
            <span className="gg-card-meta">Our cards are held until {formatDeadline(trade.holdExpiresAt)}.</span>
          )}
          <span className="gg-trd-extend">
            <label className="gg-visually-hidden" htmlFor={`gg-trd-extend-${trade.id}`}>
              Extend by
            </label>
            <select
              id={`gg-trd-extend-${trade.id}`}
              className="gg-input"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              {EXTEND_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              icon="clock"
              loading={busy === "extend"}
              disabled={busy !== null}
              onClick={() => void run("extend", () => tradeCenterRepository.extend(trade.id, hours), "Deadline extended.")}
            >
              Give more time
            </Button>
          </span>
        </div>
      )}
      {trade.inboundTracking && (
        <p>
          <strong>Their package:</strong> {carrierLabel(trade.inboundCarrier)}{" "}
          {trackingUrl ? (
            <a href={trackingUrl} target="_blank" rel="noopener noreferrer">
              {trade.inboundTracking}
            </a>
          ) : (
            trade.inboundTracking
          )}
          {trade.inboundShippedAt ? <span className="gg-card-meta"> · added {formatDateTime(trade.inboundShippedAt)}</span> : null}
          {trade.receivedAt ? <span className="gg-card-meta"> · received {formatDateTime(trade.receivedAt)}</span> : null}
        </p>
      )}
      {trade.approvalConditions && (
        <p>
          <strong>Approval conditions:</strong> {trade.approvalConditions}
        </p>
      )}
      {trade.closeReason && (status === "rejected" || status === "canceled" || status === "expired") && (
        <p>
          <strong>Reason:</strong> {trade.closeReason}
        </p>
      )}
    </section>
  );
}

function MoneySection({ trade }: { trade: StaffTrade }) {
  const m = tradeMoney(trade);
  const ourCount = trade.wanted.filter((w) => w.status !== "released").reduce((n, w) => n + w.quantity, 0);
  const stage = m.valueStage === "final" ? "final" : m.valueStage === "approved" ? "approved" : "estimated";
  return (
    <section className="gg-trd__section">
      <h3>What it adds up to</h3>
      <dl className="gg-trd-money">
        <div>
          <dt>
            Our cards ({ourCount} card{ourCount === 1 ? "" : "s"})
          </dt>
          <dd>{formatCents(m.wantedCents)}</dd>
        </div>
        <div>
          <dt>Their cards ({stage})</dt>
          <dd>{formatCents(m.valueCents)}</dd>
        </div>
        <div>
          <dt>
            Trade credit at {trade.creditRatePercent}%{trade.processingFeeCents ? `, less ${formatCents(trade.processingFeeCents)} fee` : ""}
          </dt>
          <dd>{formatCents(m.creditCents)}</dd>
        </div>
        <div>
          <dt>Shipping our cards</dt>
          <dd>{m.shippingCents === 0 ? "Free" : formatCents(m.shippingCents)}</dd>
        </div>
        <div className="gg-trd-money__total">
          <dt>
            {m.dueCents > 0
              ? "The customer pays by card"
              : m.cashCents > 0
                ? "Cash for the credit left over"
                : "Store credit left over"}
          </dt>
          <dd>{formatCents(m.dueCents > 0 ? m.dueCents : m.cashCents > 0 ? m.cashCents : m.excessCents)}</dd>
        </div>
      </dl>
    </section>
  );
}

function ReceivePanel({ trade, busy, run }: TradePanelProps) {
  return (
    <section className="gg-trd__section gg-trd-step">
      <h3>When their package arrives</h3>
      <p className="gg-card-meta">
        Marking it received emails the customer, stops the ship-by deadline and opens the inspection.
      </p>
      <div className="gg-drawer-actions__buttons">
        <Button
          variant="primary"
          icon="package"
          loading={busy === "received"}
          disabled={busy !== null}
          onClick={() => void run("received", () => tradeCenterRepository.markReceived(trade.id), "Marked received. The customer was emailed.")}
        >
          Mark the package received
        </Button>
      </div>
    </section>
  );
}

function FinalOfferSentPanel({ trade, busy, run }: TradePanelProps) {
  const adjustment = pendingAdjustment(trade);
  return (
    <section className="gg-trd__section gg-trd-step">
      <h3>Final offer{trade.finalOfferAt ? ` sent ${formatDateTime(trade.finalOfferAt)}` : ""}</h3>
      {adjustment && (
        <div className="gg-inline-note gg-inline-note--warning" role="status">
          <Icon name="message" size={18} />
          <div>
            <strong>The customer asked for an adjustment</strong> ({formatDateTime(adjustment.at)})
            {adjustment.message ? <>: &ldquo;{adjustment.message}&rdquo;</> : "."} Take the offer back to change it, or reply
            below.
          </div>
        </div>
      )}
      <p className="gg-card-meta">
        Taking it back reopens the inspection so you can change values and send a new offer. The customer can&rsquo;t accept it
        meanwhile.
      </p>
      <div className="gg-drawer-actions__buttons">
        <Button
          variant="secondary"
          icon="edit"
          loading={busy === "reopen"}
          disabled={busy !== null}
          onClick={() => void run("reopen", () => tradeCenterRepository.reopenInspection(trade.id), "Offer taken back. Revise it and send it again.")}
        >
          Take the offer back to revise
        </Button>
      </div>
    </section>
  );
}

function PaymentPanel({ trade, owner, busy, run }: TradePanelProps) {
  const [note, setNote] = useState("");
  const due = trade.amountDueCents ?? 0;
  return (
    <section className="gg-trd__section gg-trd-step">
      <h3>Waiting for {formatCents(due)}</h3>
      <p className="gg-card-meta">
        The customer accepted and pays the difference by card on their trade page. Paying finishes the trade and creates their
        order.
        {trade.paymentReference?.startsWith("pi_") ? ` Card payment started (${trade.paymentReference}).` : ""}
      </p>
      {owner ? (
        <div className="gg-trd-form">
          <TextField
            label="Paid another way? Say how"
            maxLength={200}
            value={note}
            placeholder="Cash in store"
            onChange={(e) => setNote(e.target.value)}
            hint={`Only when they paid you the ${formatCents(due)} directly. Recording it finishes the trade.`}
          />
          <div className="gg-drawer-actions__buttons">
            <Button
              variant="secondary"
              size="sm"
              icon="dollar"
              loading={busy === "pay"}
              disabled={busy !== null || !note.trim()}
              onClick={() => void run("pay", () => tradeCenterRepository.recordPayment(trade.id, note.trim()), "Payment recorded. The trade is finished.")}
            >
              Record the payment
            </Button>
          </div>
        </div>
      ) : (
        <p className="gg-card-meta">If they paid in store, the store owner can record it here.</p>
      )}
    </section>
  );
}

/** Their cards, read-only, with what happened to each (outside review and inspection). */
function TheirCards({ trade }: { trade: StaffTrade }) {
  const cards = trade.offered;
  return (
    <section className="gg-trd__section">
      <h3>
        Their cards ({cards.reduce((n, c) => n + c.quantity, 0)})
      </h3>
      {cards.length === 0 ? (
        <p className="gg-card-meta">No cards on their list yet.</p>
      ) : (
        <ul className="gg-trd-cards">
          {cards.map((c) => (
            <li key={c.id} className="gg-trd-card">
              <OfferCardHead card={c} minCardValueCents={trade.minCardValueCents} aside={<CardOutcome card={c} />} />
              {(c.reviewNote || c.internalNote || c.inspectionNote || c.inspectionInternalNote || c.flags.length > 0) && (
                <div className="gg-trd-card__notelist">
                  {c.flags.length > 0 && <p className="gg-trd-card__flag">Flagged: {c.flags.join(", ")}</p>}
                  {c.reviewNote && <p>To the customer at review: {c.reviewNote}</p>}
                  {c.inspectionNote && <p>To the customer at inspection: {c.inspectionNote}</p>}
                  {c.internalNote && <p className="gg-card-meta">Staff: {c.internalNote}</p>}
                  {c.inspectionInternalNote && <p className="gg-card-meta">Staff: {c.inspectionInternalNote}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CardOutcome({ card }: { card: StaffTradeOfferCard }) {
  if (card.inspected) {
    const taken = card.finalQuantity ?? 0;
    return (
      <div className="gg-trd-card__approved">
        <strong>{taken > 0 ? `${taken} × ${formatCents(card.finalUnitCents ?? 0)}` : "Not taken"}</strong>
        <span className="gg-card-meta">
          {card.receivedQuantity ?? 0} arrived
          {card.verifiedCondition && card.verifiedCondition !== card.reportedCondition ? ` · ${CONDITION_NAMES[card.verifiedCondition]}` : ""}
          {card.authenticity === "counterfeit" ? " · counterfeit" : card.authenticity === "unsure" ? " · authenticity unsure" : ""}
        </span>
      </div>
    );
  }
  if (card.reviewStatus === "approved") {
    return (
      <div className="gg-trd-card__approved">
        <strong>
          {card.approvedQuantity ?? 0} × {formatCents(card.approvedUnitCents ?? 0)}
        </strong>
        <span className="gg-card-meta">approved</span>
      </div>
    );
  }
  if (card.reviewStatus === "rejected") return <span className="gg-trd-card__no">Rejected</span>;
  return (
    <div className="gg-trd-card__approved">
      <strong>{card.estimatedUnitCents != null ? `${card.quantity} × ${formatCents(card.estimatedUnitCents)}` : "No price"}</strong>
      <span className="gg-card-meta">estimate</span>
    </div>
  );
}

/** Our cards on the trade; staff can take one off or lower how many until the final offer. */
function OurCards({ trade, busy, run }: Pick<TradePanelProps, "trade" | "busy" | "run">) {
  const editable = STAFF_WANTED_STATUSES.includes(trade.status);
  const held = trade.wanted.filter((w) => w.status !== "released");
  const released = trade.wanted.filter((w) => w.status === "released");
  const [confirming, setConfirming] = useState<string | null>(null);

  async function save(lineId: string, quantity: number) {
    const items = held
      .filter((w) => w.inventoryItemId)
      .map((w) => ({ inventoryItemId: w.inventoryItemId as string, quantity: w.id === lineId ? quantity : w.quantity }))
      .filter((i) => i.quantity > 0);
    const ok = await run(
      `wanted:${lineId}`,
      () => tradeCenterRepository.setWanted(trade.id, items),
      quantity === 0 ? "Taken off the trade and released." : "Updated.",
    );
    if (ok) setConfirming(null);
  }

  return (
    <section className="gg-trd__section">
      <h3>Our cards ({held.reduce((n, w) => n + w.quantity, 0)})</h3>
      {held.length === 0 ? (
        <p className="gg-card-meta">None of our cards are on this trade any more.</p>
      ) : (
        <ul className="gg-trd-cards">
          {held.map((w) => {
            const line = [w.setCode?.toUpperCase(), w.collectorNumber ? `#${w.collectorNumber}` : null].filter(Boolean).join(" ");
            const canEdit = editable && w.status === "reserved" && Boolean(w.inventoryItemId);
            return (
              <li key={w.id} className="gg-trd-card">
                <div className="gg-trd-card__head">
                  <CardThumb imageUrl={w.imageUrl} />
                  <div className="gg-trd-card__info">
                    <p className="gg-trd-card__name">{w.cardName}</p>
                    <p className="gg-trd-card__meta">
                      {[line, CONDITION_NAMES[w.condition as keyof typeof CONDITION_NAMES] ?? w.condition, w.finish !== "nonfoil" ? FINISH_NAMES[w.finish] ?? w.finish : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="gg-trd-card__meta">
                      {formatCents(w.unitPriceCents)} each · {w.status === "fulfilled" ? "on their order" : "held for this trade"}
                    </p>
                  </div>
                  <div className="gg-trd-card__aside">
                    {canEdit ? (
                      <select
                        className="gg-input gg-trd-qty"
                        aria-label={`How many ${w.cardName}`}
                        value={w.quantity}
                        disabled={busy !== null}
                        onChange={(e) => void save(w.id, Number(e.target.value))}
                      >
                        {quantityOptions(1, w.quantity).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>× {w.quantity}</span>
                    )}
                    <strong>{formatCents(w.unitPriceCents * w.quantity)}</strong>
                  </div>
                </div>
                {canEdit && held.length > 1 && (
                  <div className="gg-trd-card__controls">
                    {confirming === w.id ? (
                      <>
                        <span className="gg-card-meta">Take {w.cardName} off this trade? It goes back on sale.</span>
                        <Button size="sm" variant="danger" loading={busy === `wanted:${w.id}`} disabled={busy !== null} onClick={() => void save(w.id, 0)}>
                          Take it off
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                          Keep it
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirming(w.id)} disabled={busy !== null}>
                        Take off the trade
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {released.length > 0 && (
        <p className="gg-card-meta">
          Released from this trade: {released.map((w) => `${w.cardName} × ${w.quantity}`).join(", ")}.
        </p>
      )}
      {editable && (
        <p className="gg-card-meta">
          Lower a quantity or take a card off if it sold or isn&rsquo;t in the condition listed. The customer sees the change on
          their trade page.
        </p>
      )}
    </section>
  );
}

function RejectSection({ trade, busy, run }: TradePanelProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const beforeShipping = PRE_SHIPMENT_STATUSES.includes(trade.status);

  return (
    <section className="gg-trd__section gg-leaddetail__danger">
      <h3>Reject this trade</h3>
      <p className="gg-card-meta">
        {beforeShipping
          ? "The trade closes, our cards are released, and the customer is emailed your reason."
          : "Our cards are released and their cards go back to them (you mark them returned once mailed). The customer is emailed your reason."}
      </p>
      {open ? (
        <div className="gg-trd-form">
          <TextArea label="Reason for the customer" rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="gg-drawer-actions__buttons">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy === "reject"}
              disabled={busy !== null || !reason.trim()}
              onClick={() =>
                void run(
                  "reject",
                  () => tradeCenterRepository.reject(trade.id, reason.trim()),
                  beforeShipping ? "Trade rejected. The customer was emailed." : "Trade rejected. Mail their cards back, then mark them returned.",
                )
              }
            >
              Reject the trade
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" size="sm" onClick={() => setOpen(true)} disabled={busy !== null}>
          Reject the trade…
        </Button>
      )}
    </section>
  );
}
