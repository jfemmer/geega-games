import { Fragment, useCallback, useEffect, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TextArea, TextField } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { ErrorState, Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime } from "../../utils/format";
import { tradeCenterRepository, type TradeDetailResult } from "../../repositories/tradeCenter.supabase";
import { useNow } from "../../../store/lib/useNow";
import {
  CLOSED_TRADE_STATUSES,
  CONDITION_NAMES,
  STAFF_CANCELABLE_STATUSES,
  STAFF_REJECTABLE_STATUSES,
  STAFF_WANTED_STATUSES,
  formatDeadline,
  timeLeft,
  tradeLabel,
  tradeStatusAdminLabel,
  valueForCreditCents,
  type StaffTrade,
  type StaffTradeOfferCard,
  type TradeSettings,
  type TradeStatus,
} from "../../../store/lib/tradeCenter";
import { LOYALTY_TIER_LABELS, onTimePercent } from "../../../store/lib/tradeRules";
import { tradeEconomics } from "../../../store/lib/tradeEconomics";
import { carrierLabel, trackingUrlFor } from "../../../store/lib/tracking";
import { ORDER_STATUS_LABELS, type OrderStatus } from "../../../store/lib/orderStatus";
import { CUSTOMER_FAULT_LABELS, REVIEW_FLAG_LABELS, TRADE_STATUS_TONE, customerEmailNote } from "./tradeLabels";
import { centsInput, extendedDeadline, parseUnitCents, pendingAdjustment, quantityOptions, tradeMoney } from "./tradeMath";
import { CardThumb, FoilTag, OfferCardHead } from "./TradeCardBits";
import { colorGroupOf, isWantedSort, loadWantedSort, saveWantedSort, sortWanted, WANTED_SORTS, type WantedSort } from "./tradeCardSort";
import { TradeReviewPanel } from "./TradeReviewPanel";
import { TradeInspectionPanel } from "./TradeInspectionPanel";
import { MailBack, TradeWrapUpPanel } from "./TradeWrapUpPanel";
import { TradeDepositPanel, TradeDisputesPanel } from "./TradeDepositPanel";
import { PackagingLine, ReleaseReservation, TradeExpiredPanel, TradeShipmentPanel } from "./TradeShipmentPanel";
import { LocalMeetupPanel, LocalReviewPanel, LocalSettledNote, MeetupDetailsSection } from "./LocalPickupPanels";
import { TradeHistory, TradeMessagesPanel } from "./TradeConversation";
import type { TradePanelProps } from "./types";

// One online trade, everything staff do with it, changing with where it
// stands: the customer and their record, what's flagged and the deadline
// (and more time), what it adds up to, the deposit and proof of shipping,
// the step that's waiting (review, confirmation, the shipment, inspection
// and the final offer, payment, wrapping up, or an expired reservation), our
// cards on it, messages, history, and rejecting or canceling it. A local
// pickup trade (LocalPickupPanels.tsx) is approved without a card review,
// has a meetup instead of a shipment, and is finished at the meetup.

/** What staff do next, by status. */
const STAFF_NEXT: Record<TradeStatus, string> = {
  awaiting_trade_list: "The customer is still building their trade. Nothing is reserved.",
  pending_review: "Review each card below, then approve the trade, ask for changes, or reject it.",
  revision_requested: "Waiting for the customer to change their trade. Nothing is reserved.",
  awaiting_confirmation: "Approved. Waiting for the customer to confirm (and pay any deposit). Nothing is reserved yet.",
  awaiting_deposit: "The customer confirmed and is paying the deposit. Our cards are reserved the moment it goes through.",
  awaiting_shipment: "Our cards are reserved. Waiting for the customer to ship and add tracking.",
  tracking_submitted: "Tracking added. Waiting for the carrier's first scan.",
  in_transit: "Shipped in time and on its way. Mark it received when it arrives.",
  received: "The package is here. Inspect the cards below.",
  under_inspection: "Finish inspecting, then send the final offer.",
  awaiting_final_approval: "Final offer sent. Waiting for the customer to accept it, ask for an adjustment, or decline.",
  awaiting_payment: "Accepted. Waiting for the customer to pay by card: any of our cards the credit doesn't cover, and shipping.",
  approved_for_fulfillment: "Finished. Pack and ship their order, and add the cards you took to inventory.",
  completed: "Complete: their order shipped.",
  rejected: "Rejected before it was confirmed. Nothing was reserved.",
  offer_expired: "Closed: not sent or confirmed in time. Nothing was reserved.",
  canceled: "Canceled by the customer. Our cards were released.",
  expired: "The reservation expired and our cards were released.",
  canceled_after_shipment: "The customer canceled after shipping, with no penalty.",
  declined_after_inspection: "The customer declined the final offer, with no penalty.",
  canceled_by_store: "You canceled this trade. Any deposit is refunded in full.",
};

/** What staff do next on a local pickup trade, where it differs. */
const LOCAL_STAFF_NEXT: Partial<Record<TradeStatus, string>> = {
  awaiting_trade_list: "The customer is still picking our cards. Nothing is reserved. Their cards are valued when you meet.",
  pending_review: "Local pickup: approve it (no card review, no deposit), ask for changes, or reject it.",
  awaiting_confirmation: "Approved. Waiting for the customer to confirm. Nothing is reserved yet.",
  awaiting_shipment: "Our cards are held for the meetup. Agree on a time and place in the messages, then record their cards below when you meet.",
  completed: "Complete: traded in person. Add the cards you took to inventory.",
  canceled: "Canceled by the customer. Our cards went back on sale.",
  expired: "The hold ended before you met. Our cards went back on sale.",
};

/** The deadline that's running, by status, and the kind of extension that moves it. */
function runningDeadline(trade: StaffTrade): { label: string; at: string | null; original: string | null; kind: "list" | "confirmation" | "shipping" | "payment" } | null {
  switch (trade.status) {
    case "awaiting_trade_list":
      return { label: "Draft due", at: trade.listDueAt, original: null, kind: "list" };
    case "revision_requested":
      return { label: "Changes due", at: trade.listDueAt, original: null, kind: "list" };
    case "awaiting_confirmation":
    case "awaiting_deposit":
      return { label: "Confirm by", at: trade.confirmBy, original: trade.confirmByOriginal, kind: "confirmation" };
    case "awaiting_shipment":
    case "tracking_submitted":
      return {
        label: trade.handoffMethod === "local" ? "Hold ends" : "Ship by",
        at: trade.shipBy,
        original: trade.shipByOriginal,
        kind: "shipping",
      };
    case "awaiting_payment":
      return { label: "Payment due", at: trade.paymentDueAt, original: null, kind: "payment" };
    default:
      return null;
  }
}

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
        toast.success(`${done}${customerEmailNote(result.customerEmail)}`);
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
      headerExtra={
        trade ? <Badge tone={TRADE_STATUS_TONE[trade.status]}>{tradeStatusAdminLabel(trade.status, trade.handoffMethod)}</Badge> : null
      }
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
  const { trade, busy, run, onOpenOrder } = props;
  const status = trade.status;
  const finished = status === "approved_for_fulfillment" || status === "completed";
  const showReview = status === "pending_review";
  const showInspection = status === "received" || status === "under_inspection";

  if (trade.handoffMethod === "local") return <LocalTradeBody {...props} />;

  return (
    <div className="gg-trd">
      <CustomerSection trade={trade} />
      <StandingSection {...props} />
      <MoneySection {...props} />
      <ShipmentsSection trade={trade} />
      <TradeDepositPanel {...props} />
      <TradeDisputesPanel {...props} />

      {showReview && <TradeReviewPanel {...props} />}
      {(status === "awaiting_confirmation" || status === "awaiting_deposit") && <ConfirmationPanel {...props} />}
      {(status === "awaiting_shipment" || status === "tracking_submitted" || status === "in_transit") && <TradeShipmentPanel {...props} />}
      {showInspection && <TradeInspectionPanel {...props} />}
      {status === "awaiting_final_approval" && <FinalOfferSentPanel {...props} />}
      {status === "awaiting_payment" && <PaymentPanel {...props} />}
      {finished && <TradeWrapUpPanel {...props} onOpenOrder={onOpenOrder} />}
      {status === "expired" && <TradeExpiredPanel {...props} />}
      {!finished && CLOSED_TRADE_STATUSES.has(status) && <MailBack trade={trade} busy={busy} run={run} />}

      {!showReview && !showInspection && <TheirCards trade={trade} />}
      <OurCards trade={trade} busy={busy} run={run} />
      <TradeMessagesPanel trade={trade} busy={busy} run={run} />
      <TradeHistory trade={trade} />
      {STAFF_REJECTABLE_STATUSES.includes(status) && status !== "pending_review" && <RejectSection {...props} />}
      {STAFF_CANCELABLE_STATUSES.includes(status) && <CancelByStoreSection {...props} />}
    </div>
  );
}

/** A local pickup trade: approve, arrange the meetup, finish it there. Nothing ships, nothing is inspected by mail. */
function LocalTradeBody(props: TradePanelProps & { onOpenOrder: (orderId: string) => void }) {
  const { trade, busy, run, onOpenOrder } = props;
  const status = trade.status;
  const finished = status === "approved_for_fulfillment" || status === "completed";
  const meetupOpen = status === "pending_review" || status === "awaiting_confirmation" || status === "awaiting_shipment";
  return (
    <div className="gg-trd">
      <CustomerSection trade={trade} />
      <StandingSection {...props} />
      <MoneySection {...props} />

      {status === "pending_review" && <LocalReviewPanel {...props} />}
      {meetupOpen && status !== "pending_review" && <MeetupDetailsSection trade={trade} settings={props.settings} busy={busy} run={run} />}
      {(status === "awaiting_confirmation" || status === "awaiting_deposit") && <ConfirmationPanel {...props} />}
      {status === "awaiting_shipment" && (
        <>
          <LocalMeetupPanel {...props} />
          <section className="gg-trd__section">
            <ReleaseReservation trade={trade} busy={busy} run={run} />
          </section>
        </>
      )}
      {finished && <TradeWrapUpPanel {...props} onOpenOrder={onOpenOrder} />}
      {status === "expired" && <TradeExpiredPanel {...props} />}

      {(finished || trade.offered.length > 0) && status !== "awaiting_shipment" && <TheirCards trade={trade} />}
      <OurCards trade={trade} busy={busy} run={run} />
      <TradeMessagesPanel trade={trade} busy={busy} run={run} />
      <TradeHistory trade={trade} />
      {STAFF_REJECTABLE_STATUSES.includes(status) && status !== "pending_review" && <RejectSection {...props} />}
      {STAFF_CANCELABLE_STATUSES.includes(status) && <CancelByStoreSection {...props} />}
    </div>
  );
}

function CustomerSection({ trade }: { trade: StaffTrade }) {
  const subject = encodeURIComponent(`Your Geega Games trade ${tradeLabel(trade.tradeNumber)}`);
  const r = trade.customerRecord;
  const p = trade.privileges;
  const onTime = r ? onTimePercent(r) : null;
  return (
    <section className="gg-trd__section">
      <h3>Customer</h3>
      <p>
        <strong>{trade.customerName || "Customer"}</strong>
        {trade.handoffMethod === "local" && (
          <>
            {" "}
            <Badge tone="purple">Local pickup</Badge>
          </>
        )}
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
        {trade.confirmedAt ? ` · confirmed ${formatDateTime(trade.confirmedAt)}` : ""}
      </p>
      {r && p && (
        <div className="gg-trd-record">
          <p>
            <strong>{LOYALTY_TIER_LABELS[p.tier]}</strong>
            <span className="gg-card-meta">
              {" "}
              · {r.completedTrades} completed trade{r.completedTrades === 1 ? "" : "s"}
              {onTime !== null ? ` · ${onTime}% shipped on time` : ""}
              {` · ${p.shipDays} days to ship`}
            </span>
          </p>
          {(r.recentFaults > 0 || r.abandonedReservations > 0 || r.missedDeadlines > 0) && (
            <p className="gg-card-meta">
              {r.abandonedReservations} canceled after confirming · {r.missedDeadlines} missed deadline{r.missedDeadlines === 1 ? "" : "s"} ·{" "}
              {r.recentFaults} counting now
            </p>
          )}
          <div className="gg-trd-badges">
            {r.depositRequired && <Badge tone="gold">Deposit on every trade (set by you)</Badge>}
            {p.reliabilityDeposit && <Badge tone="gold">Over the abandonment limit: deposit required</Badge>}
            {p.blocked && <Badge tone="danger">No new trades</Badge>}
          </div>
          {r.flagNote && <p className="gg-card-meta">Note: {r.flagNote}</p>}
        </div>
      )}
      {trade.customerNote && <p className="gg-trd-card__quote">Their note: &ldquo;{trade.customerNote}&rdquo;</p>}
    </section>
  );
}

/** Where it stands: what staff do next, anything flagged, the running deadline (and more time), conditions, why it closed. */
function StandingSection({ trade, owner, busy, run, settings }: TradePanelProps) {
  const status = trade.status;
  const deadline = runningDeadline(trade);
  const now = useNow();
  const needsYou = trade.needsStaff;

  return (
    <section className="gg-trd__section gg-trd-standing">
      <p className="gg-trd-standing__next">
        <Icon name={needsYou ? "alert" : "info"} size={16} />
        {(trade.handoffMethod === "local" ? LOCAL_STAFF_NEXT[status] : undefined) ?? STAFF_NEXT[status]}
      </p>
      {trade.reviewFlag && (
        <div className="gg-inline-note gg-inline-note--warning" role="status">
          <Icon name="warning" size={18} />
          <div>
            <strong>{REVIEW_FLAG_LABELS[trade.reviewFlag]}.</strong>
            {trade.reviewFlagAt ? <span className="gg-card-meta"> Since {formatDateTime(trade.reviewFlagAt)}.</span> : null} It won&rsquo;t
            expire or be refunded on its own while this is open.
          </div>
        </div>
      )}
      {deadline?.at && (
        <div className="gg-trd-deadline">
          <span>
            <strong>{deadline.label}:</strong> {formatDeadline(deadline.at)}{" "}
            <span className="gg-card-meta">
              ({Date.parse(deadline.at) > now ? `${timeLeft(Date.parse(deadline.at), now)} left` : "past due"})
            </span>
          </span>
          {deadline.original && deadline.original !== deadline.at && (
            <span className="gg-card-meta">Originally {formatDeadline(deadline.original)}.</span>
          )}
          <ExtendDeadline trade={trade} settings={settings} kind={deadline.kind} at={deadline.at} busy={busy} run={run} />
        </div>
      )}
      {trade.extensions.length > 0 && (
        <details className="gg-trd-extensions">
          <summary>More time given ({trade.extensions.length})</summary>
          <ul className="gg-trd-plain">
            {trade.extensions.map((e) => (
              <li key={e.id}>
                {formatDateTime(e.createdAt)}: {e.kind} deadline to {formatDeadline(e.toDeadline)}
                {e.customerRequested ? " (customer asked)" : ""}
                {e.reason ? ` · ${e.reason}` : ""}
                {e.createdBy ? <span className="gg-card-meta"> · {e.createdBy}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {trade.customerFault && (
        <div className="gg-trd-fault">
          <span>
            <strong>Counts against the customer:</strong> {CUSTOMER_FAULT_LABELS[trade.customerFault]}
            {trade.faultAt ? <span className="gg-card-meta"> ({formatDateTime(trade.faultAt)})</span> : null}
          </span>
          {owner && (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "clearFault"}
              disabled={busy !== null}
              onClick={() => void run("clearFault", () => tradeCenterRepository.clearFault(trade.id), "It no longer counts against them.")}
            >
              Don&rsquo;t count it
            </Button>
          )}
        </div>
      )}
      {!trade.customerFault && trade.faultClearedAt && (
        <p className="gg-card-meta">
          A fault on this trade was cleared {formatDateTime(trade.faultClearedAt)}
          {trade.faultClearedBy ? ` by ${trade.faultClearedBy}` : ""}.
        </p>
      )}
      {trade.approvalConditions && (
        <p>
          <strong>Approval conditions:</strong> {trade.approvalConditions}
        </p>
      )}
      {trade.closeReason && CLOSED_TRADE_STATUSES.has(status) && (
        <p>
          <strong>Reason:</strong> {trade.closeReason}
        </p>
      )}
    </section>
  );
}

/** More time on the running deadline (confirmation and shipping count qualifying hours). */
function ExtendDeadline({
  trade,
  settings,
  kind,
  at,
  busy,
  run,
}: {
  trade: StaffTrade;
  settings: TradeSettings;
  kind: "list" | "confirmation" | "shipping" | "payment";
  at: string;
  busy: string | null;
  run: TradePanelProps["run"];
}) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(48);
  const [asked, setAsked] = useState(false);
  const [reason, setReason] = useState("");
  const next = extendedDeadline(kind, at, hours, settings);

  if (!open) {
    return (
      <span className="gg-trd-extend">
        <Button size="sm" variant="secondary" icon="clock" disabled={busy !== null} onClick={() => setOpen(true)}>
          Give more time…
        </Button>
      </span>
    );
  }
  return (
    <div className="gg-trd-form gg-trd-extendform">
      <div className="gg-form-grid">
        <label className="gg-trd-field">
          <span>Extend by</span>
          <select className="gg-input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {EXTEND_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Reason (optional, staff only)" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <label className="gg-check-inline">
        <input type="checkbox" checked={asked} onChange={(e) => setAsked(e.target.checked)} />
        The customer asked for it
      </label>
      <p className="gg-card-meta">
        New deadline: {formatDeadline(new Date(next).toISOString())}
        {kind === "confirmation" || kind === "shipping" ? " (Sundays don't count)" : ""}. The customer is emailed.
      </p>
      <div className="gg-drawer-actions__buttons">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy === "extend"}
          disabled={busy !== null}
          onClick={async () => {
            const ok = await run(
              "extend",
              () => tradeCenterRepository.extend(trade.id, { kind, hours, customerRequested: asked, reason: reason.trim() }),
              "Deadline extended.",
            );
            if (ok) setOpen(false);
          }}
        >
          Extend
        </Button>
      </div>
    </div>
  );
}

/** Approved, waiting for the customer to confirm (and pay any deposit): what they see, and sending it back. */
function ConfirmationPanel({ trade, busy, run }: TradePanelProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const short = trade.wanted.filter((w) => w.status === "requested" && w.available !== null && w.available < w.quantity);
  return (
    <section className="gg-trd__section gg-trd-step" aria-labelledby="gg-trd-confirm-title">
      <h3 id="gg-trd-confirm-title">Waiting for the customer to confirm</h3>
      <p className="gg-card-meta">
        {trade.handoffMethod === "local" ? (
          <>
            Approved{trade.approvedAt ? ` ${formatDateTime(trade.approvedAt)}` : ""}. They see our cards and how long we&rsquo;ll hold them,
            tick the box and confirm (no deposit). Our cards stay on sale until then.
          </>
        ) : (
          <>
            Approved{trade.approvedAt ? ` ${formatDateTime(trade.approvedAt)}` : ""}. They see the cards, both deadlines and the deposit
            terms, tick the box and confirm{trade.deposit.cents > 0 ? `, paying the ${formatCents(trade.deposit.cents)} deposit` : ""}. Our
            cards stay on sale until then.
          </>
        )}
      </p>
      {short.length > 0 && (
        <p className="gg-trd-blocker" role="note">
          <Icon name="warning" size={16} /> Sold since approval: {short.map((w) => `${w.cardName} (${w.available} of ${w.quantity} left)`).join(", ")}.
          The trade goes back to the customer to pick again (within a few minutes, or when they try to confirm).
        </p>
      )}
      {open ? (
        <div className="gg-trd-form">
          <TextArea
            label="What should they change?"
            rows={3}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            hint="Takes the approval back: the trade returns to the customer to change and send again. Emailed to them."
          />
          <div className="gg-drawer-actions__buttons">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy === "revise"}
              disabled={busy !== null || !message.trim()}
              onClick={async () => {
                const ok = await run("revise", () => tradeCenterRepository.requestRevision(trade.id, message.trim()), "Sent back with your message.");
                if (ok) setOpen(false);
              }}
            >
              Send it back
            </Button>
          </div>
        </div>
      ) : (
        <div className="gg-drawer-actions__buttons">
          <Button size="sm" variant="secondary" icon="edit" onClick={() => setOpen(true)} disabled={busy !== null}>
            Ask for changes instead…
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * What the trade adds up to: both sides' values, the rate applied, what the
 * credit doesn't cover, shipping our cards (paid by card, never out of
 * credit), the card payment and any credit left over. Once it's finished:
 * what shipping cost against what was charged, the theoretical change in
 * inventory value, and our cards' shipment.
 */
function MoneySection(props: TradePanelProps) {
  if (props.trade.handoffMethod === "local") return <LocalMoneySection {...props} />;
  return <ShippedMoneySection {...props} />;
}

/** A local pickup trade's money: our cards, what of theirs covers them, and (once finished) how it settled in person. */
function LocalMoneySection({ trade, settings, busy, run }: TradePanelProps) {
  const m = tradeMoney(trade);
  const finished = trade.status === "approved_for_fulfillment" || trade.status === "completed";
  const ourCount = trade.wanted.filter((w) => w.status !== "released").reduce((n, w) => n + w.quantity, 0);
  const bring = valueForCreditCents(trade.wantedTotalCents, trade.creditRatePercent, trade.processingFeeCents);
  return (
    <section className="gg-trd__section">
      <h3>What it adds up to</h3>
      <dl className="gg-trd-money">
        <div>
          <dt>
            Our cards ({ourCount} card{ourCount === 1 ? "" : "s"}, retail)
          </dt>
          <dd>{formatCents(m.wantedCents)}</dd>
        </div>
        {finished ? (
          <>
            <div>
              <dt>Their cards (TCG low, at the meetup)</dt>
              <dd>{formatCents(trade.finalValueCents ?? 0)}</dd>
            </div>
            <div>
              <dt>
                Trade credit at {trade.creditRatePercent}%{trade.processingFeeCents ? `, less ${formatCents(trade.processingFeeCents)} fee` : ""}
              </dt>
              <dd>{formatCents(m.creditCents)}</dd>
            </div>
            <div className="gg-trd-money__total">
              <dt>{m.dueCents > 0 ? "Paid in person" : "Nothing to pay"}</dt>
              <dd>{formatCents(m.dueCents)}</dd>
            </div>
            {m.excessCents > 0 && (
              <div>
                <dt>{m.cashCents > 0 ? "Credit left over, paid as cash" : "Credit left over (store credit)"}</dt>
                <dd>{formatCents(m.cashCents > 0 ? m.cashCents : m.excessCents)}</dd>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <dt>Their cards</dt>
              <dd>Valued at the meetup</dd>
            </div>
            <div>
              <dt>Their cards that cover ours at {trade.creditRatePercent}%</dt>
              <dd>{formatCents(bring)}</dd>
            </div>
            <div>
              <dt>Shipping and deposit</dt>
              <dd>None</dd>
            </div>
          </>
        )}
      </dl>
      {finished && <LocalSettledNote trade={trade} />}
      {finished && <TradeEconomicsBlock trade={trade} settings={settings} busy={busy} run={run} />}
    </section>
  );
}

function ShippedMoneySection({ trade, settings, busy, run }: TradePanelProps) {
  const m = tradeMoney(trade);
  const ourCount = trade.wanted.filter((w) => w.status !== "released").reduce((n, w) => n + w.quantity, 0);
  const stage = m.valueStage === "final" ? "final" : m.valueStage === "approved" ? "approved" : "estimated";
  const finished = trade.status === "approved_for_fulfillment" || trade.status === "completed";
  const settled = trade.shippingCents !== null;
  return (
    <section className="gg-trd__section">
      <h3>What it adds up to</h3>
      <dl className="gg-trd-money">
        <div>
          <dt>
            Our cards ({ourCount} card{ourCount === 1 ? "" : "s"}, retail)
          </dt>
          <dd>{formatCents(m.wantedCents)}</dd>
        </div>
        <div>
          <dt>Their cards ({stage === "estimated" ? "estimated at market" : `${stage}, TCG low`})</dt>
          <dd>{formatCents(m.valueCents)}</dd>
        </div>
        <div>
          <dt>
            Trade credit at {trade.creditRatePercent}%{trade.processingFeeCents ? `, less ${formatCents(trade.processingFeeCents)} fee` : ""}
          </dt>
          <dd>{formatCents(m.creditCents)}</dd>
        </div>
        <div>
          <dt>Our cards the credit doesn&rsquo;t cover</dt>
          <dd>{formatCents(m.cardBalanceCents)}</dd>
        </div>
        <div>
          <dt>
            Shipping our cards{" "}
            <span className="gg-card-meta">
              {trade.paidAt ? "collected with the payment" : settled ? "set when they accepted" : "as the trade stands"}
            </span>
          </dt>
          <dd>{m.shippingCents === 0 ? "Free" : formatCents(m.shippingCents)}</dd>
        </div>
        <div className="gg-trd-money__total">
          <dt>{m.dueCents > 0 ? (trade.paidAt ? "Paid by card" : "The customer pays by card") : "Nothing to pay by card"}</dt>
          <dd>{formatCents(m.dueCents)}</dd>
        </div>
        {m.excessCents > 0 && (
          <div>
            <dt>{m.cashCents > 0 ? "Credit left over, paid as cash" : "Credit left over (store credit)"}</dt>
            <dd>{formatCents(m.cashCents > 0 ? m.cashCents : m.excessCents)}</dd>
          </div>
        )}
      </dl>
      {finished && <TradeEconomicsBlock trade={trade} settings={settings} busy={busy} run={run} />}
    </section>
  );
}

const SHIPMENT_PANEL_STATUSES: ReadonlySet<TradeStatus> = new Set(["awaiting_shipment", "tracking_submitted", "in_transit"]);

/** Both shipments at a glance once their package is past the shipment step: theirs to us, and our cards to them. */
function ShipmentsSection({ trade }: { trade: StaffTrade }) {
  const s = trade.shipment;
  const showTheirs = s.tracking !== null && !SHIPMENT_PANEL_STATUSES.has(trade.status);
  if (!showTheirs && !trade.outgoing) return null;
  const url = trackingUrlFor(s.carrier, s.tracking);
  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-shipments-title">
      <h3 id="gg-trd-shipments-title">Shipments</h3>
      {showTheirs && (
        <>
          <p className="gg-trd-outgoing">
            <strong>Their cards to us:</strong> {carrierLabel(s.carrier)}{" "}
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                {s.tracking}
              </a>
            ) : (
              s.tracking
            )}
            {s.acceptedAt ? <span className="gg-card-meta"> · carrier accepted {formatDateTime(s.acceptedAt)}</span> : null}
            {s.deliveredAt ? <span className="gg-card-meta"> · delivered {formatDateTime(s.deliveredAt)}</span> : null}
          </p>
          <PackagingLine trade={trade} />
        </>
      )}
      <OutgoingShipmentLine trade={trade} />
    </section>
  );
}

/** A finished trade: shipping cost against what was charged, and the theoretical inventory-value difference. */
function TradeEconomicsBlock({ trade, settings, busy, run }: Pick<TradePanelProps, "trade" | "settings" | "busy" | "run">) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [postage, setPostage] = useState(centsInput(trade.outboundPostageCents));
  const e = tradeEconomics(
    {
      finalValueCents: trade.finalValueCents,
      wantedTotalCents: trade.wantedTotalCents,
      shippingCents: trade.shippingCents,
      orderPostageCents: trade.orderPostageCents,
      outboundPostageCents: trade.outboundPostageCents,
      localPickup: trade.handoffMethod === "local",
    },
    settings.shipCostEstimateCents,
  );
  if (!e) return null;
  const source =
    e.shippingCostSource === "none"
      ? "picked up in person"
      : e.shippingCostSource === "label"
        ? "label bought here"
        : e.shippingCostSource === "recorded"
          ? "recorded"
          : "estimate, from Settings";

  async function save(clear: boolean) {
    const raw = postage.trim();
    const cents = clear || raw === "" ? null : parseUnitCents(raw);
    if (!clear && raw !== "" && (cents === null || cents > 100_000)) {
      toast.error("Enter what the postage cost, like 5.40.");
      return;
    }
    const ok = await run("postage", () => tradeCenterRepository.setPostage(trade.id, cents), cents === null ? "Postage cleared." : "Postage saved.");
    if (ok) setEditing(false);
  }

  return (
    <div className="gg-trd-econ">
      <h4>Shipping and inventory value</h4>
      <dl className="gg-trd-money">
        <div>
          <dt>Shipping charged</dt>
          <dd>{e.shippingChargedCents === 0 ? "Free" : formatCents(e.shippingChargedCents)}</dd>
        </div>
        <div>
          <dt>Estimated shipping cost</dt>
          <dd>{formatCents(settings.shipCostEstimateCents)}</dd>
        </div>
        <div>
          <dt>
            Actual shipping cost <span className="gg-card-meta">({source})</span>
          </dt>
          <dd>{e.shippingCostSource === "estimate" ? "Not recorded" : e.shippingCostSource === "none" ? "None" : formatCents(e.shippingCostCents)}</dd>
        </div>
        <div>
          <dt>Net shipping expense</dt>
          <dd>{e.netShippingCents < 0 ? `−${formatCents(-e.netShippingCents)}` : formatCents(e.netShippingCents)}</dd>
        </div>
        <div>
          <dt>Gross inventory value difference</dt>
          <dd>{signedCents(e.grossDifferenceCents)}</dd>
        </div>
        <div className="gg-trd-money__total">
          <dt>Shipping-adjusted inventory value difference</dt>
          <dd>{signedCents(e.adjustedDifferenceCents)}</dd>
        </div>
      </dl>
      <p className="gg-card-meta">
        Theoretical: what their cards we took are worth (the TCG low you set), less the retail value of ours, less net shipping. It
        isn&rsquo;t profit: it doesn&rsquo;t account for what our cards cost us, fees or cash flow.
      </p>
      {e.shippingCostSource !== "label" &&
        e.shippingCostSource !== "none" &&
        (editing ? (
          <div className="gg-trd-form gg-trd-postage">
            <label className="gg-trd-field">
              <span>What the postage cost</span>
              <span className="gg-trd-dollar">
                <input
                  className="gg-input"
                  inputMode="decimal"
                  value={postage}
                  placeholder="0.00"
                  aria-label="What the postage for our cards cost"
                  onChange={(ev) => setPostage(ev.target.value)}
                />
              </span>
            </label>
            <div className="gg-drawer-actions__buttons">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy !== null}>
                Cancel
              </Button>
              {trade.outboundPostageCents !== null && (
                <Button size="sm" variant="secondary" onClick={() => void save(true)} disabled={busy !== null}>
                  Clear
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => void save(false)} loading={busy === "postage"} disabled={busy !== null}>
                Save postage
              </Button>
            </div>
          </div>
        ) : (
          <div className="gg-drawer-actions__buttons">
            <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(true)} disabled={busy !== null}>
              {trade.outboundPostageCents !== null ? "Change the postage" : "Record the postage"}
            </Button>
          </div>
        ))}
    </div>
  );
}

/** "+$44.00" or "−$12.50". */
function signedCents(cents: number): string {
  return `${cents < 0 ? "−" : "+"}${formatCents(Math.abs(cents))}`;
}

/** Our cards on their way to the customer (the trade's order). */
function OutgoingShipmentLine({ trade }: { trade: StaffTrade }) {
  const o = trade.outgoing;
  if (!o) return null;
  const url = trackingUrlFor(o.carrier, o.tracking);
  return (
    <p className="gg-card-meta gg-trd-outgoing">
      <strong>Our cards to the customer:</strong> {ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status}
      {o.tracking ? (
        <>
          {" "}
          · {carrierLabel(o.carrier)}{" "}
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {o.tracking}
            </a>
          ) : (
            o.tracking
          )}
        </>
      ) : (
        " · no tracking yet"
      )}
      {o.shippedAt ? ` · shipped ${formatDateTime(o.shippedAt)}` : ""}
      {o.deliveredAt ? ` · delivered ${formatDateTime(o.deliveredAt)}` : ""}
    </p>
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
  const onTrade = trade.wanted.filter((w) => w.status === "requested" || w.status === "reserved" || w.status === "fulfilled");
  const offTrade = trade.wanted.filter((w) => w.status === "released" || w.status === "removed");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sort, setSort] = useState<WantedSort>(loadWantedSort);
  const sorted = sortWanted(onTrade, sort);

  function changeSort(next: WantedSort) {
    setSort(next);
    saveWantedSort(next);
  }

  async function save(lineId: string, quantity: number) {
    const items = onTrade
      .filter((w) => w.inventoryItemId)
      .map((w) => ({ inventoryItemId: w.inventoryItemId as string, quantity: w.id === lineId ? quantity : w.quantity }))
      .filter((i) => i.quantity > 0);
    const ok = await run(
      `wanted:${lineId}`,
      () => tradeCenterRepository.setWanted(trade.id, items),
      quantity === 0 ? "Taken off the trade." : "Updated.",
    );
    if (ok) setConfirming(null);
  }

  return (
    <section className="gg-trd__section">
      <div className="gg-trd__sectionhead">
        <h3>Our cards ({onTrade.reduce((n, w) => n + w.quantity, 0)})</h3>
        {onTrade.length > 1 && (
          <label className="gg-trd-sort">
            <span>Sort by</span>
            <select
              className="gg-input"
              value={sort}
              onChange={(e) => {
                if (isWantedSort(e.target.value)) changeSort(e.target.value);
              }}
            >
              {WANTED_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {onTrade.length === 0 ? (
        <p className="gg-card-meta">None of our cards are on this trade any more.</p>
      ) : (
        <ul className="gg-trd-cards">
          {sorted.map((w, i) => {
            // Sorted by color: a heading where each color group starts.
            const group = sort === "color" ? colorGroupOf(w).label : null;
            const newGroup = group !== null && (i === 0 || colorGroupOf(sorted[i - 1]).label !== group);
            const line = [w.setCode?.toUpperCase(), w.collectorNumber ? `#${w.collectorNumber}` : null].filter(Boolean).join(" ");
            const canEdit = editable && (w.status === "reserved" || w.status === "requested") && Boolean(w.inventoryItemId);
            const short = w.status === "requested" && w.available !== null && w.available < w.quantity;
            return (
              <Fragment key={w.id}>
                {newGroup && (
                  <li className="gg-trd-cards__group">
                    {group}
                  </li>
                )}
              <li className={`gg-trd-card${w.finish !== "nonfoil" ? " gg-trd-card--foil" : ""}`}>
                <div className="gg-trd-card__head">
                  <CardThumb imageUrl={w.imageUrl} alt={w.cardName} foil={w.finish !== "nonfoil"} />
                  <div className="gg-trd-card__info">
                    <p className="gg-trd-card__name">
                      {w.cardName}
                      <FoilTag finish={w.finish} />
                    </p>
                    <p className="gg-trd-card__meta">
                      {[line, CONDITION_NAMES[w.condition as keyof typeof CONDITION_NAMES] ?? w.condition].filter(Boolean).join(" · ")}
                    </p>
                    <p className="gg-trd-card__meta">
                      {formatCents(w.unitPriceCents)} each ·{" "}
                      {w.status === "fulfilled" ? "on their order" : w.status === "reserved" ? "reserved for this trade" : "not reserved yet (still on sale)"}
                    </p>
                    {short && (
                      <p className="gg-trd-card__flag">
                        {w.available === 0 ? "Sold out since it was added" : `Only ${w.available} available now`}
                      </p>
                    )}
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
                {canEdit && onTrade.length > 1 && (
                  <div className="gg-trd-card__controls">
                    {confirming === w.id ? (
                      <>
                        <span className="gg-card-meta">
                          Take {w.cardName} off this trade?{w.status === "reserved" ? " It goes back on sale." : ""}
                        </span>
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
              </Fragment>
            );
          })}
        </ul>
      )}
      {offTrade.length > 0 && (
        <p className="gg-card-meta">
          No longer on this trade: {offTrade.map((w) => `${w.cardName} × ${w.quantity} (${w.status === "removed" ? "taken off" : "released"})`).join(", ")}.
        </p>
      )}
      {editable && (
        <p className="gg-card-meta">
          Lower a quantity or take a card off if it sold or isn&rsquo;t in the condition listed. The customer sees the change on their trade
          page.
        </p>
      )}
    </section>
  );
}

/** Before the trade is confirmed: nothing is held and nothing paid (an unpaid deposit payment is canceled). */
function RejectSection({ trade, busy, run }: TradePanelProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <section className="gg-trd__section gg-leaddetail__danger">
      <h3>Reject this trade</h3>
      <p className="gg-card-meta">The trade closes and the customer is emailed your reason. Nothing was reserved or charged.</p>
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
              onClick={() => void run("reject", () => tradeCenterRepository.reject(trade.id, reason.trim()), "Trade rejected.")}
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

/** A confirmed trade: our cards are released, any deposit is refunded in full, and cards that reached us go back. */
function CancelByStoreSection({ trade, busy, run }: TradePanelProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const shipped = trade.shipment.acceptedAt !== null || trade.receivedAt !== null;
  const paid = trade.deposit.status === "paid" || trade.deposit.status === "forfeiture_review";

  return (
    <section className="gg-trd__section gg-leaddetail__danger">
      <h3>Cancel this trade</h3>
      <p className="gg-card-meta">
        For when you can&rsquo;t go ahead (a card is damaged in stock, a pricing error). Our cards are released
        {paid ? ", the deposit is refunded in full" : ""}
        {shipped ? ", and their cards come back to them (mark them returned once mailed)" : ""}. It never counts against the customer.
      </p>
      {open ? (
        <div className="gg-trd-form">
          <TextArea label="Reason for the customer" rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="gg-drawer-actions__buttons">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy !== null}>
              Keep the trade
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={busy === "cancel"}
              disabled={busy !== null || !reason.trim()}
              onClick={() =>
                void run(
                  "cancel",
                  () => tradeCenterRepository.cancelByStore(trade.id, reason.trim()),
                  shipped ? "Trade canceled. Mail their cards back, then mark them returned." : "Trade canceled.",
                )
              }
            >
              Cancel the trade
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" size="sm" onClick={() => setOpen(true)} disabled={busy !== null}>
          Cancel the trade…
        </Button>
      )}
    </section>
  );
}
