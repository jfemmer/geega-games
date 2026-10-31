import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextArea, TextField } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime } from "../../utils/format";
import { AddTradeCardDrawer, type TradeCardPick } from "../../components/trade/AddTradeCardDrawer";
import { priceForFinish } from "../../utils/pricing";
import { parsePriceCents } from "../../utils/tradeEvaluator";
import { tradeCenterRepository, type LocalCardInput } from "../../repositories/tradeCenter.supabase";
import {
  CARD_CONDITIONS,
  CONDITION_NAMES,
  FINISH_NAMES,
  LOCAL_PAYMENT_LABELS,
  TRADE_LIMITS,
  meetSpotLine,
  meetSpotMapUrl,
  meetSpotOf,
  printingLabel,
  valueForCreditCents,
  type CardConditionCode,
  type MeetSpot,
  type StaffTrade,
} from "../../../store/lib/tradeCenter";
import { centsInput, meetupTotals, quantityOptions } from "./tradeMath";
import { CardThumb } from "./TradeCardBits";
import type { TradePanelProps } from "./types";

// Admin Trades for local pickup trades: the customer picked our cards and
// sent the trade without listing theirs. Staff approve it (no card review,
// never a deposit) with where to meet if they know, keep the meetup details
// up to date, and at the meetup record each card they take (searched like
// the Trade Evaluator, valued at its TCG low for the condition they see) and
// what the customer paid in person, which finishes the trade: the credit is
// issued, our cards go on an in-person order, and the trade is complete.

type Outcome = "approve" | "revise" | "reject";

/** The saved meeting spot, with a map link (staff check it before writing the meetup). */
function SpotLine({ spot }: { spot: MeetSpot }) {
  return (
    <p className="gg-card-meta">
      <strong>Meeting spot:</strong> {meetSpotLine(spot)} ·{" "}
      <a href={meetSpotMapUrl(spot)} target="_blank" rel="noopener noreferrer">
        Map
      </a>
    </p>
  );
}

/** Pending review: approve (with where to meet), ask for changes, or reject. */
export function LocalReviewPanel({ trade, settings, busy, run }: TradePanelProps) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<Outcome>("approve");
  const [meetup, setMeetup] = useState(trade.meetupDetails ?? "");
  const spot = meetSpotOf(settings);
  const [conditions, setConditions] = useState("");
  const [revision, setRevision] = useState("");
  const [reason, setReason] = useState("");
  const short = trade.wanted.filter((w) => w.status === "requested" && w.available !== null && w.available < w.quantity);
  const bring = valueForCreditCents(trade.wantedTotalCents, trade.creditRatePercent, trade.processingFeeCents);
  // Local pickup never takes a deposit, so a customer you'd normally ask for one gets a mention here.
  const flagged = Boolean(trade.customerRecord?.depositRequired || trade.privileges?.reliabilityDeposit);

  async function finish() {
    if (outcome === "approve") {
      await run(
        "approve",
        () => tradeCenterRepository.approve(trade.id, { conditions: conditions.trim(), meetupDetails: meetup.trim() }),
        "Approved: our cards are held until you finish the trade.",
      );
    } else if (outcome === "revise") {
      if (!revision.trim()) {
        toast.error("Tell the customer what to change.");
        return;
      }
      await run("revise", () => tradeCenterRepository.requestRevision(trade.id, revision.trim()), "Sent back with your message.");
    } else {
      if (!reason.trim()) {
        toast.error("Give the customer a reason.");
        return;
      }
      await run("reject", () => tradeCenterRepository.reject(trade.id, reason.trim()), "Trade rejected.");
    }
  }

  return (
    <section className="gg-trd__section gg-trd-step" aria-labelledby="gg-trd-local-review-title">
      <h3 id="gg-trd-local-review-title">Review this local pickup trade</h3>
      <p className="gg-card-meta">
        They want {formatCents(trade.wantedTotalCents)} of our cards and will bring theirs to the meetup (about {formatCents(bring)} at TCG
        low covers ours at {trade.creditRatePercent}%). There&rsquo;s nothing of theirs to review now: you value their cards when you meet.
      </p>
      {flagged && (
        <p className="gg-trd-blocker" role="note">
          <Icon name="warning" size={16} /> This customer would need a deposit on a shipped trade (canceled or missed reservations
          before). Local pickup has no deposit: approve only if you&rsquo;re happy to hold our cards for them.
        </p>
      )}
      {short.length > 0 && (
        <p className="gg-trd-blocker" role="note">
          <Icon name="warning" size={16} /> Fewer left than they picked:{" "}
          {short.map((w) => `${w.cardName} (${w.available} of ${w.quantity})`).join(", ")}. Change our cards below, or ask them to.
        </p>
      )}

      <div className="gg-trd-decide">
        <div className="gg-trd-seg gg-trd-seg--wide" role="group" aria-label="What to do with this trade">
          <button type="button" className="gg-trd-seg__btn" aria-pressed={outcome === "approve"} onClick={() => setOutcome("approve")}>
            Approve
          </button>
          <button type="button" className="gg-trd-seg__btn" aria-pressed={outcome === "revise"} onClick={() => setOutcome("revise")}>
            Ask for changes
          </button>
          <button type="button" className="gg-trd-seg__btn" aria-pressed={outcome === "reject"} onClick={() => setOutcome("reject")}>
            Reject
          </button>
        </div>

        {outcome === "approve" && (
          <div className="gg-trd-decide__body">
            <p className="gg-card-meta">
              Approving takes our cards off sale and holds them until you finish or cancel the trade, with no deadline. The customer is
              emailed that it&rsquo;s approved; there&rsquo;s nothing for them to confirm, and no deposit.
            </p>
            {spot && <SpotLine spot={spot} />}
            <TextArea
              label={spot ? "When to meet (optional)" : "Where and when to meet (optional)"}
              rows={2}
              maxLength={2000}
              value={meetup}
              onChange={(e) => setMeetup(e.target.value)}
              hint={
                spot
                  ? "Sent with the approval, under the meeting spot they already see. Meeting somewhere else this time? Say so here. Not sure yet? Leave it blank and set it up in the messages."
                  : "Sent with the approval. Not sure yet? Leave it blank and set it up with them in the messages."
              }
            />
            <TextArea
              label="Conditions (optional)"
              rows={2}
              maxLength={2000}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              hint="Anything the approval depends on, such as “Bring at least $80 of cards, or pay the difference.”"
            />
            {short.length > 0 && (
              <p className="gg-trd-blocker" role="note">
                <Icon name="info" size={16} /> Fix our cards first: some aren&rsquo;t available in that quantity.
              </p>
            )}
            <div className="gg-drawer-actions__buttons">
              <Button variant="primary" onClick={finish} loading={busy === "approve"} disabled={busy !== null || short.length > 0}>
                Approve and email the customer
              </Button>
            </div>
          </div>
        )}

        {outcome === "revise" && (
          <div className="gg-trd-decide__body">
            <TextArea
              label="What should they change?"
              rows={3}
              maxLength={4000}
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              hint={`Emailed to the customer. They have ${settings.revisionHours} hours to send their changes; nothing is reserved meanwhile.`}
            />
            <div className="gg-drawer-actions__buttons">
              <Button variant="primary" onClick={finish} loading={busy === "revise"} disabled={busy !== null || !revision.trim()}>
                Send it back to the customer
              </Button>
            </div>
          </div>
        )}

        {outcome === "reject" && (
          <div className="gg-trd-decide__body">
            <TextArea
              label="Reason for the customer"
              rows={2}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="The trade closes (nothing was reserved) and the customer is emailed this reason."
            />
            <div className="gg-drawer-actions__buttons">
              <Button variant="danger" onClick={finish} loading={busy === "reject"} disabled={busy !== null || !reason.trim()}>
                Reject the trade
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Where and when to meet: shown to the customer, emailed when it changes once the trade is approved. */
export function MeetupDetailsSection({ trade, settings, busy, run }: Pick<TradePanelProps, "trade" | "settings" | "busy" | "run">) {
  const [editing, setEditing] = useState(false);
  const spot = meetSpotOf(settings);
  const [text, setText] = useState(trade.meetupDetails ?? "");
  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-meetup-title">
      <div className="gg-trd__sectionhead">
        <h3 id="gg-trd-meetup-title">Meetup</h3>
        {!editing && (
          <Button size="sm" variant="secondary" icon="edit" disabled={busy !== null} onClick={() => setEditing(true)}>
            {trade.meetupDetails ? "Change" : spot ? "Set when" : "Set where and when"}
          </Button>
        )}
      </div>
      {spot && <SpotLine spot={spot} />}
      {editing ? (
        <div className="gg-trd-form">
          <TextArea
            label={spot ? "When to meet (and anything different this time)" : "Where and when to meet"}
            rows={3}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            hint="The customer sees this on their trade page and is emailed when it changes. Agree on it in the messages first."
          />
          <div className="gg-drawer-actions__buttons">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setText(trade.meetupDetails ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy === "meetup"}
              disabled={busy !== null || text.trim() === (trade.meetupDetails ?? "")}
              onClick={async () => {
                const ok = await run("meetup", () => tradeCenterRepository.setMeetup(trade.id, text.trim()), "Meetup saved.");
                if (ok) setEditing(false);
              }}
            >
              Save the meetup
            </Button>
          </div>
        </div>
      ) : trade.meetupDetails ? (
        <p className="gg-trd-meetup">{trade.meetupDetails}</p>
      ) : (
        <p className="gg-card-meta">
          {spot
            ? "Not set yet. Agree on a time at the meeting spot in the messages, then save it here."
            : "Not set yet. Agree on a time and a public place in the messages, then save it here."}
        </p>
      )}
    </section>
  );
}

/** One of their cards staff are taking, as typed. */
interface MeetRow {
  key: string;
  scryfallId: string | null;
  cardName: string;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  finish: string;
  imageUrl: string | null;
  condition: CardConditionCode;
  quantity: number;
  /** Each copy's TCG low, as typed. */
  unit: string;
  referencePriceCents: number | null;
}

let rowSeq = 0;
const nextKey = () => `row-${(rowSeq += 1)}`;

/** Starting rows: any cards the customer listed before switching to local pickup. */
function rowsOf(trade: StaffTrade): MeetRow[] {
  return trade.offered.map((c) => ({
    key: nextKey(),
    scryfallId: c.scryfallId,
    cardName: c.cardName,
    setCode: c.setCode,
    setName: c.setName,
    collectorNumber: c.collectorNumber,
    finish: c.finish,
    imageUrl: c.imageUrl,
    condition: c.reportedCondition,
    quantity: Math.min(Math.max(c.quantity, 1), TRADE_LIMITS.maxQuantity),
    unit: centsInput(c.estimatedUnitCents),
    referencePriceCents: c.referencePriceCents,
  }));
}

function rowFromPick(pick: TradeCardPick): MeetRow {
  const p = pick.printing;
  const reference = priceForFinish(p, pick.finish);
  return {
    key: nextKey(),
    scryfallId: p.scryfallId || null,
    cardName: p.cardName,
    setCode: p.setCode || null,
    setName: p.setName || null,
    collectorNumber: p.collectorNumber || null,
    finish: pick.finish,
    imageUrl: p.imageUrl || null,
    condition: pick.condition,
    quantity: Math.min(pick.quantity, TRADE_LIMITS.maxQuantity),
    unit: pick.price,
    referencePriceCents: reference,
  };
}

/** A typed TCG low in cents, within what a trade allows; null when it isn't one. */
function unitCents(text: string): number | null {
  const cents = parsePriceCents(text);
  return cents !== null && cents <= TRADE_LIMITS.maxEstimateCents ? cents : null;
}

type PayMethod = "cash" | "card" | "other";

/** Reserved for the meetup: record the cards taken and what they paid, and finish the trade. */
export function LocalMeetupPanel({ trade, settings, owner, busy, run }: TradePanelProps) {
  const toast = useToast();
  const [rows, setRows] = useState<MeetRow[]>(() => rowsOf(trade));
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [note, setNote] = useState("");
  const [cash, setCash] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const priced = rows.map((r) => ({ row: r, cents: unitCents(r.unit) }));
  const unpriced = priced.filter((p) => p.cents === null);
  const totals = meetupTotals(
    trade,
    priced.map((p) => ({ quantity: p.row.quantity, unitCents: p.cents ?? 0 })),
    settings,
  );
  const useCash = cash && totals.cashOptionCents > 0;
  const blocker = !owner
    ? "Only the store owner can finish a trade at the meetup."
    : unpriced.length > 0
      ? `Enter the TCG low for ${unpriced.length === 1 ? unpriced[0].row.cardName : `${unpriced.length} cards`}.`
      : totals.dueCents > 0 && !method
        ? `Choose how they paid the ${formatCents(totals.dueCents)}.`
        : !agreed
          ? "Tick the box once you've both agreed and swapped cards."
          : null;

  const change = (key: string, patch: Partial<MeetRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function finish() {
    if (blocker) {
      toast.error(blocker);
      return;
    }
    const cards: LocalCardInput[] = priced.map(({ row, cents }) => ({
      scryfallId: row.scryfallId,
      cardName: row.cardName,
      setCode: row.setCode,
      setName: row.setName,
      collectorNumber: row.collectorNumber,
      finish: row.finish,
      imageUrl: row.imageUrl,
      condition: row.condition,
      quantity: row.quantity,
      unitCents: cents ?? 0,
      referencePriceCents: row.referencePriceCents,
      note: null,
    }));
    await run(
      "completeLocal",
      () =>
        tradeCenterRepository.completeLocal(trade.id, {
          cards,
          paidCents: totals.dueCents,
          paymentMethod: totals.dueCents > 0 ? method : null,
          paymentNote: note.trim(),
          cashForExcess: useCash,
        }),
      "Trade complete. Their cards are ready to add to inventory.",
    );
  }

  return (
    <section className="gg-trd__section gg-trd-step" aria-labelledby="gg-trd-meet-title">
      <h3 id="gg-trd-meet-title">At the meetup</h3>
      <p className="gg-card-meta">
        Add each card you&rsquo;re taking, with the condition you see and its TCG low for that condition. Cards you don&rsquo;t take stay with
        them. Changing our cards? Edit them under &ldquo;Our cards&rdquo; first.
      </p>

      {rows.length === 0 ? (
        <p className="gg-card-meta">No cards yet. If they&rsquo;re buying our cards outright, leave this empty.</p>
      ) : (
        <ul className="gg-trd-cards">
          {priced.map(({ row, cents }) => (
            <li key={row.key} className="gg-trd-card">
              <div className="gg-trd-card__head">
                <CardThumb imageUrl={row.imageUrl} alt={row.cardName} />
                <div className="gg-trd-card__info">
                  <p className="gg-trd-card__name">{row.cardName}</p>
                  <p className="gg-trd-card__meta">
                    {[
                      printingLabel({ setCode: row.setCode, collectorNumber: row.collectorNumber, finish: row.finish }) ||
                        (row.finish !== "nonfoil" ? (FINISH_NAMES[row.finish] ?? row.finish) : null),
                      row.referencePriceCents != null ? `Scryfall ${formatCents(row.referencePriceCents)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="gg-trd-card__aside">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label={`Remove ${row.cardName}`}
                    disabled={busy !== null}
                    onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <div className="gg-trd-meet">
                <label className="gg-trd-field">
                  <span>Condition</span>
                  <select
                    className="gg-input"
                    value={row.condition}
                    onChange={(e) => change(row.key, { condition: e.target.value as CardConditionCode })}
                  >
                    {CARD_CONDITIONS.map((code) => (
                      <option key={code} value={code}>
                        {CONDITION_NAMES[code]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gg-trd-field">
                  <span>Taking</span>
                  <select className="gg-input" value={row.quantity} onChange={(e) => change(row.key, { quantity: Number(e.target.value) })}>
                    {quantityOptions(1, Math.max(row.quantity, 20)).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gg-trd-field">
                  <span>TCG low each</span>
                  <span className="gg-trd-dollar">
                    <input
                      className="gg-input"
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-invalid={cents === null}
                      aria-label={`TCG low each for ${row.cardName}`}
                      value={row.unit}
                      onChange={(e) => change(row.key, { unit: e.target.value })}
                    />
                  </span>
                </label>
                <div className="gg-trd-field gg-trd-field--total">
                  <span>Counts for</span>
                  <strong>{cents === null ? "—" : formatCents(cents * row.quantity)}</strong>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="gg-drawer-actions__buttons">
        <Button size="sm" variant="secondary" icon="plus" disabled={busy !== null || rows.length >= settings.maxOfferedLines} onClick={() => setAdding(true)}>
          Add a card they&rsquo;re trading in
        </Button>
      </div>
      {adding && (
        <AddTradeCardDrawer
          onClose={() => setAdding(false)}
          onAdd={(pick) => setRows((prev) => [...prev, rowFromPick(pick)])}
        />
      )}

      <dl className="gg-trd-money gg-trd-money--preview">
        <div>
          <dt>Their cards (TCG low)</dt>
          <dd>{formatCents(totals.valueCents)}</dd>
        </div>
        <div>
          <dt>
            Trade credit at {trade.creditRatePercent}%{trade.processingFeeCents ? `, less ${formatCents(trade.processingFeeCents)} fee` : ""}
          </dt>
          <dd>{formatCents(totals.creditCents)}</dd>
        </div>
        <div>
          <dt>Our cards</dt>
          <dd>{formatCents(trade.wantedTotalCents)}</dd>
        </div>
        <div className="gg-trd-money__total">
          <dt>{totals.dueCents > 0 ? "They pay you now" : "Nothing for them to pay"}</dt>
          <dd>{formatCents(totals.dueCents)}</dd>
        </div>
        {totals.excessCents > 0 && (
          <div>
            <dt>{useCash ? "Credit left over, paid as cash" : "Credit left over (store credit)"}</dt>
            <dd>{formatCents(useCash ? totals.cashOptionCents : totals.excessCents)}</dd>
          </div>
        )}
      </dl>

      {totals.cashOptionCents > 0 && (
        <label className="gg-check-inline gg-trd-cash">
          <input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} />
          Pay the {formatCents(totals.excessCents)} left over as {formatCents(totals.cashOptionCents)} cash instead (at the{" "}
          {settings.localCashRatePercent}% local pickup cash rate). Record it paid once you&rsquo;ve handed it over.
        </label>
      )}

      {totals.dueCents > 0 && (
        <div className="gg-trd-form">
          <div className="gg-trd-seg" role="group" aria-label="How they paid">
            {(["cash", "card", "other"] as const).map((m) => (
              <button key={m} type="button" className="gg-trd-seg__btn" aria-pressed={method === m} onClick={() => setMethod(m)}>
                {LOCAL_PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
          <TextField
            label="Payment note (optional, staff only)"
            maxLength={160}
            value={note}
            placeholder={method === "card" ? "Square, last 4 1234" : method === "other" ? "Venmo @name" : ""}
            onChange={(e) => setNote(e.target.value)}
            hint={`Collect ${formatCents(totals.dueCents)} before you hand over our cards. Card payments are taken on your own reader; nothing is charged here.`}
          />
        </div>
      )}

      <label className="gg-check-inline">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        The customer agreed to these values{totals.dueCents > 0 ? ", paid," : ""} and we swapped cards
      </label>
      <p className="gg-card-meta">
        Finishing issues their credit, puts our cards on an in-person order (marked picked up) and completes the trade. The customer is
        emailed a receipt. It can&rsquo;t be undone.
      </p>
      {!owner && <p className="gg-card-meta">Only the store owner can finish a trade at the meetup (it records a payment and issues credit).</p>}
      <div className="gg-drawer-actions__buttons">
        <Button variant="primary" icon="check" loading={busy === "completeLocal"} disabled={busy !== null || blocker !== null} onClick={() => void finish()}>
          Finish the trade
        </Button>
      </div>
    </section>
  );
}

/** A finished local trade: when and how it settled in person. */
export function LocalSettledNote({ trade }: { trade: StaffTrade }) {
  const method = trade.localPaymentMethod;
  return (
    <p className="gg-card-meta">
      Finished at the meetup{trade.metAt ? ` ${formatDateTime(trade.metAt)}` : ""}.{" "}
      {method && method !== "none"
        ? `They paid ${formatCents(trade.localPaidCents ?? 0)} (${LOCAL_PAYMENT_LABELS[method].toLowerCase()}).`
        : "Nothing to pay."}{" "}
      Our cards were handed over in person.
    </p>
  );
}
