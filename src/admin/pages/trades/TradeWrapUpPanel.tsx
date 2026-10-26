import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime } from "../../utils/format";
import { tradeCenterRepository } from "../../repositories/tradeCenter.supabase";
import { carrierLabel, trackingUrlFor } from "../../../store/lib/tracking";
import {
  CONDITION_NAMES,
  TRADE_CARRIERS,
  cleanTrackingNumber,
  copiesToReturn,
  printingLabel,
  type StaffTradeOfferCard,
  type TradeCarrier,
} from "../../../store/lib/tradeCenter";
import { centsInput, parseUnitCents, tradeMoney } from "./tradeMath";
import { CardThumb } from "./TradeCardBits";
import type { TradePanelProps } from "./types";

// After the customer accepted (and paid): how it settled, their order, the
// cash for leftover credit when the final offer included it (owner marks it
// paid), the cards we took going into inventory, and mailing back what we
// didn't take. Also the return itself when a trade closed after their cards
// were sent (declined, canceled after shipping, canceled by us, or a package
// that arrived after its reservation expired): return_status pending →
// returned.

export function TradeWrapUpPanel({ trade, owner, busy, run, onOpenOrder }: TradePanelProps & { onOpenOrder: (orderId: string) => void }) {
  const finished = trade.status === "approved_for_fulfillment" || trade.status === "completed";
  return (
    <>
      {finished && <Settlement trade={trade} owner={owner} busy={busy} run={run} onOpenOrder={onOpenOrder} />}
      {finished && <IntoInventory trade={trade} busy={busy} run={run} />}
      <MailBack trade={trade} busy={busy} run={run} />
    </>
  );
}

function Settlement({
  trade,
  owner,
  busy,
  run,
  onOpenOrder,
}: Pick<TradePanelProps, "trade" | "owner" | "busy" | "run"> & { onOpenOrder: (orderId: string) => void }) {
  const money = tradeMoney(trade);
  const [cashNote, setCashNote] = useState("");
  // Credit covers our cards only; shipping is always part of the card payment.
  const usedCents = Math.min(trade.creditIssuedCents ?? money.creditCents, money.wantedCents);
  const shippingPaid = Math.min(money.shippingCents, money.dueCents);
  const paidBy = trade.paymentReference?.startsWith("manual: ")
    ? `Recorded by hand: ${trade.paymentReference.slice("manual: ".length)}`
    : trade.paymentReference?.startsWith("pi_")
      ? "Card (Stripe)"
      : null;

  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-settled-title">
      <div className="gg-trd__sectionhead">
        <h3 id="gg-trd-settled-title">How it settled</h3>
        {trade.orderId && (
          <Button size="sm" variant="secondary" icon="orders" onClick={() => onOpenOrder(trade.orderId as string)}>
            Open their order
          </Button>
        )}
      </div>
      <dl className="gg-trd-money">
        <div>
          <dt>Trade credit issued</dt>
          <dd>{formatCents(trade.creditIssuedCents ?? 0)}</dd>
        </div>
        <div>
          <dt>Used on our cards</dt>
          <dd>{formatCents(usedCents)}</dd>
        </div>
        {money.dueCents > 0 && (
          <div>
            <dt>
              Paid{paidBy ? ` (${paidBy})` : ""}
              <span className="gg-card-meta">
                {" "}
                {formatCents(money.dueCents - shippingPaid)} for our cards, {formatCents(shippingPaid)} shipping
              </span>
            </dt>
            <dd>{formatCents(money.dueCents)}</dd>
          </div>
        )}
        {money.dueCents === 0 && (
          <div>
            <dt>Shipping our cards</dt>
            <dd>{money.shippingCents === 0 ? "Free" : formatCents(money.shippingCents)}</dd>
          </div>
        )}
        {money.cashCents > 0 ? (
          <div className="gg-trd-money__total">
            <dt>Cash owed for the credit left over</dt>
            <dd>{formatCents(money.cashCents)}</dd>
          </div>
        ) : money.excessCents > 0 ? (
          <div className="gg-trd-money__total">
            <dt>Left on their store credit</dt>
            <dd>{formatCents(money.excessCents)}</dd>
          </div>
        ) : null}
      </dl>
      {trade.status === "approved_for_fulfillment" && (
        <p className="gg-card-meta">Pack and ship their order from Orders. The trade completes when the order ships.</p>
      )}

      {money.cashCents > 0 &&
        (trade.cashPaidAt ? (
          <p className="gg-trd-ok">
            <Icon name="check" size={14} /> Cash paid {formatDateTime(trade.cashPaidAt)}
          </p>
        ) : owner ? (
          <div className="gg-trd-form">
            <p>
              <strong>{formatCents(money.cashCents)} cash is owed to the customer.</strong> Pay it, then record it here.
            </p>
            <TextField
              label="How you paid (optional)"
              maxLength={200}
              value={cashNote}
              placeholder="Cash at pickup, Venmo…"
              onChange={(e) => setCashNote(e.target.value)}
            />
            <div className="gg-drawer-actions__buttons">
              <Button
                variant="primary"
                size="sm"
                loading={busy === "cash"}
                disabled={busy !== null}
                onClick={() => void run("cash", () => tradeCenterRepository.markCashPaid(trade.id, cashNote.trim()), "Cash marked paid.")}
              >
                Mark the cash paid
              </Button>
            </div>
          </div>
        ) : (
          <p className="gg-trd-blocker" role="note">
            <Icon name="info" size={16} /> {formatCents(money.cashCents)} cash is owed. The store owner records it once it&rsquo;s paid.
          </p>
        ))}
    </section>
  );
}

function IntoInventory({ trade, busy, run }: Pick<TradePanelProps, "trade" | "busy" | "run">) {
  const taken = trade.offered.filter((c) => (c.finalQuantity ?? 0) > 0 && (c.disposition === "accepted" || c.disposition === "imported"));
  if (taken.length === 0) return null;
  const waiting = taken.filter((c) => c.disposition === "accepted").length;
  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-import-title">
      <h3 id="gg-trd-import-title">Add the cards you took to inventory</h3>
      <p className="gg-card-meta">
        {waiting > 0
          ? "Set each card's selling price. If you already stock that printing in that condition, the copies join that line and keep its price. Cost is recorded as the trade credit paid for them."
          : "Every card you took is in inventory."}
      </p>
      <ul className="gg-trd-cards">
        {taken.map((c) => (
          <ImportRow key={c.id} card={c} busy={busy} run={run} />
        ))}
      </ul>
    </section>
  );
}

function ImportRow({ card, busy, run }: { card: StaffTradeOfferCard } & Pick<TradePanelProps, "busy" | "run">) {
  const toast = useToast();
  const [price, setPrice] = useState(centsInput(card.referencePriceCents ?? card.finalUnitCents));
  const [location, setLocation] = useState("");
  const condition = card.verifiedCondition ?? card.reportedCondition;
  const imported = card.disposition === "imported";
  const key = `import:${card.id}`;

  async function add() {
    const cents = parseUnitCents(price);
    if (cents === null || cents < 1) {
      toast.error("Set a selling price.");
      return;
    }
    await run(key, () => tradeCenterRepository.importCard(card.id, cents, location.trim()), `${card.cardName} added to inventory.`);
  }

  return (
    <li className="gg-trd-card">
      <div className="gg-trd-card__head">
        <CardThumb imageUrl={card.imageUrl} />
        <div className="gg-trd-card__info">
          <p className="gg-trd-card__name">{card.cardName}</p>
          <p className="gg-trd-card__meta">
            {[printingLabel(card), CONDITION_NAMES[condition], `× ${card.finalQuantity ?? 0}`].filter(Boolean).join(" · ")}
          </p>
          <p className="gg-trd-card__meta">
            Taken at {formatCents(card.finalUnitCents ?? 0)} each
            {card.referencePriceCents != null ? ` · market ${formatCents(card.referencePriceCents)}` : ""}
          </p>
        </div>
        {imported && (
          <div className="gg-trd-card__aside">
            <span className="gg-trd-ok">
              <Icon name="check" size={14} /> In inventory
            </span>
          </div>
        )}
      </div>
      {!imported && (
        <div className="gg-trd-import">
          <label className="gg-trd-field">
            <span>Selling price each</span>
            <span className="gg-trd-dollar">
              <input
                className="gg-input"
                inputMode="decimal"
                value={price}
                placeholder="0.00"
                aria-label={`Selling price each for ${card.cardName}`}
                onChange={(e) => setPrice(e.target.value)}
              />
            </span>
          </label>
          <label className="gg-trd-field gg-trd-field--grow">
            <span>Storage location (optional)</span>
            <input
              className="gg-input"
              value={location}
              maxLength={120}
              placeholder="Binder 3"
              aria-label={`Storage location for ${card.cardName}`}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <Button size="sm" variant="primary" icon="plus" onClick={add} loading={busy === key} disabled={busy !== null}>
            Add {card.finalQuantity ?? 0} to inventory
          </Button>
        </div>
      )}
    </li>
  );
}

/** What goes back to the customer, and marking it mailed. */
export function MailBack({ trade, busy, run }: Pick<TradePanelProps, "trade" | "busy" | "run">) {
  const toast = useToast();
  const [carrier, setCarrier] = useState<TradeCarrier>("USPS");
  const [tracking, setTracking] = useState("");
  const finished = trade.status === "approved_for_fulfillment" || trade.status === "completed";
  if (trade.returnStatus === "none") return null;

  // A trade that closed after they shipped: everything they sent. A finished one: what we didn't take.
  const lines = finished
    ? trade.offered.map((c) => ({ card: c, copies: copiesToReturn(c) })).filter((l) => l.copies > 0)
    : trade.offered
        .filter((c) => c.reviewStatus === "approved")
        .map((c) => ({ card: c, copies: c.inspected ? (c.receivedQuantity ?? 0) : (c.approvedQuantity ?? 0) }))
        .filter((l) => l.copies > 0);

  const done = trade.returnStatus === "returned";
  const url = trackingUrlFor(trade.returnCarrier, trade.returnTracking);

  async function markReturned() {
    const raw = tracking.trim();
    if (raw && !cleanTrackingNumber(raw)) {
      toast.error("That tracking number doesn't look right.");
      return;
    }
    await run(
      "returned",
      () => tradeCenterRepository.markReturned(trade.id, { carrier, trackingNumber: raw }),
      "Marked returned.",
    );
  }

  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-return-title">
      <h3 id="gg-trd-return-title">{done ? "Mailed back" : "Mail their cards back"}</h3>
      {!finished && trade.closeReason && <p className="gg-card-meta">Why: {trade.closeReason}</p>}
      {lines.length > 0 ? (
        <ul className="gg-trd-plain">
          {lines.map(({ card, copies }) => (
            <li key={card.id}>
              <strong>{copies} ×</strong> {card.cardName} <span className="gg-card-meta">{printingLabel(card)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gg-card-meta">Send back whatever arrived from this customer.</p>
      )}
      {!done && !finished && !trade.receivedAt && (
        <p className="gg-card-meta">Their package hasn&rsquo;t been marked received yet. Send it back once it arrives.</p>
      )}

      {done ? (
        <p className="gg-trd-ok">
          <Icon name="check" size={14} /> Mailed back{trade.returnedAt ? ` ${formatDateTime(trade.returnedAt)}` : ""}
          {trade.returnTracking && (
            <>
              {" "}
              · {carrierLabel(trade.returnCarrier)}{" "}
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {trade.returnTracking}
                </a>
              ) : (
                trade.returnTracking
              )}
            </>
          )}
        </p>
      ) : (
        <div className="gg-trd-form">
          <div className="gg-form-grid">
            <SelectField label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value as TradeCarrier)}>
              {TRADE_CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Tracking number (optional)"
              value={tracking}
              maxLength={60}
              onChange={(e) => setTracking(e.target.value)}
              hint="Included in the email to the customer."
            />
          </div>
          <div className="gg-drawer-actions__buttons">
            <Button variant="primary" size="sm" onClick={markReturned} loading={busy === "returned"} disabled={busy !== null}>
              Mark returned and email the customer
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
