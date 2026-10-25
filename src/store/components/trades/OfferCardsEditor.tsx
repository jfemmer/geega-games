import { useState } from "react";
import { SellCardSearch } from "../sell/SellCardSearch";
import { formatCents } from "../../lib/money";
import type { SellPrinting } from "../../lib/sellTypes";
import {
  BLOCKING_ELIGIBILITY,
  CARD_CONDITIONS,
  CONDITION_NAMES,
  FINISH_NAMES,
  TRADE_LIMITS,
  printingLabel,
  conditionPercent,
  eligibilityFor,
  eligibilityMessage,
  estimatedUnitCents,
  type CardConditionCode,
  type CustomerTrade,
  type TradeFinish,
  type TradeOfferCard,
  type TradeOfferInput,
  type TradeTerms,
} from "../../lib/tradeCenter";
import { OfferImport } from "./OfferImport";
import { finishesOf, offerInputs, printingPrice } from "./offerHelpers";

// The customer's cards on a trade. While they can still change the list:
// find each card's exact printing (the same public card search as Sell Your
// Cards), pick its finish, condition and how many, or paste a list / upload
// a CSV; change or remove lines. Every change is saved straight away and
// priced by the server, so the estimates shown are always the server's.
// After the list is sent it's read-only, with staff's review and, later,
// what the inspection found.

export function OfferCardsEditor({
  trade,
  terms,
  editable,
  saving,
  onSave,
}: {
  trade: CustomerTrade;
  terms: TradeTerms | null;
  editable: boolean;
  saving: boolean;
  onSave: (cards: TradeOfferInput[]) => Promise<boolean>;
}) {
  const [picked, setPicked] = useState<SellPrinting | null>(null);
  const [searchKey, setSearchKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const cards = trade.offered;
  const current = offerInputs(cards);
  const maxLines = terms?.maxOfferedLines ?? 100;

  async function change(next: TradeOfferInput[]) {
    await onSave(next);
  }

  return (
    <div className="gg-tc-offer">
      {editable && (
        <div className="gg-tc-offer__add">
          {picked ? (
            <AddPrinting
              printing={picked}
              trade={trade}
              terms={terms}
              saving={saving}
              onCancel={() => setPicked(null)}
              onAdd={async (input) => {
                const ok = await onSave([...current, input]);
                if (ok) {
                  setPicked(null);
                  setSearchKey((k) => k + 1);
                }
              }}
            />
          ) : importing ? (
            <OfferImport
              trade={trade}
              terms={terms}
              saving={saving}
              room={Math.max(maxLines - cards.length, 0)}
              onCancel={() => setImporting(false)}
              onAdd={async (inputs) => {
                const ok = await onSave([...current, ...inputs]);
                if (ok) setImporting(false);
                return ok;
              }}
            />
          ) : (
            <>
              <SellCardSearch key={searchKey} onSelect={setPicked} />
              <p className="gg-tc-offer__or">
                Have a list?{" "}
                <button type="button" className="gg-linkbtn" onClick={() => setImporting(true)}>
                  Paste it or upload a CSV
                </button>
              </p>
            </>
          )}
        </div>
      )}

      {cards.length === 0 ? (
        <p className="gg-tc-empty">
          {editable ? "Search for the first card you'd like to trade in." : "No cards were listed."}
        </p>
      ) : (
        <ul className="gg-tc-lines gg-tc-lines--offer">
          {cards.map((card) => (
            <OfferCardRow
              key={card.id}
              card={card}
              trade={trade}
              editable={editable}
              saving={saving}
              onQuantity={(quantity) => void change(current.map((c) => (c.id === card.id ? { ...c, quantity } : c)))}
              onCondition={(condition) => void change(current.map((c) => (c.id === card.id ? { ...c, condition } : c)))}
              onRemove={() => void change(current.filter((c) => c.id !== card.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddPrinting({
  printing,
  trade,
  terms,
  saving,
  onAdd,
  onCancel,
}: {
  printing: SellPrinting;
  trade: CustomerTrade;
  terms: TradeTerms | null;
  saving: boolean;
  onAdd: (input: TradeOfferInput) => void;
  onCancel: () => void;
}) {
  const finishes = finishesOf(printing);
  const [finish, setFinish] = useState<TradeFinish>(finishes[0]);
  const [condition, setCondition] = useState<CardConditionCode>("NM");
  const [quantity, setQuantity] = useState(1);
  const reference = printingPrice(printing, finish);
  const pct = conditionPercent(trade.conditionPercents, condition);
  const estimate = estimatedUnitCents(reference, pct);
  const eligibility = eligibilityFor(
    { estimatedUnitCents: estimate, setCode: printing.setCode, cardName: printing.cardName },
    {
      minCardValueCents: trade.minCardValueCents,
      excludedSetCodes: terms?.excludedSetCodes ?? [],
      excludedCardNames: terms?.excludedCardNames ?? [],
      overstockThreshold: 0, // the server checks our stock
    },
  );
  const blocked = BLOCKING_ELIGIBILITY.has(eligibility);

  return (
    <div className="gg-tc-pick">
      {printing.imageUrl && <img className="gg-tc-pick__img" src={printing.imageUrl} alt="" />}
      <div className="gg-tc-pick__body">
        <p className="gg-tc-pick__name">{printing.cardName}</p>
        <p className="gg-tc-line__meta">
          {printing.setName} ({printing.setCode}) · #{printing.collectorNumber}
        </p>
        <fieldset className="gg-tc-pick__finish">
          <legend>Finish</legend>
          {finishes.map((f) => (
            <label key={f}>
              <input type="radio" name="gg-tc-finish" value={f} checked={finish === f} onChange={() => setFinish(f)} />{" "}
              {FINISH_NAMES[f]}
            </label>
          ))}
        </fieldset>
        <div className="gg-tc-pick__row">
          <label className="gg-field">
            <span>Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value as CardConditionCode)}>
              {CARD_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_NAMES[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="gg-field">
            <span>How many</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={TRADE_LIMITS.maxQuantity}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(TRADE_LIMITS.maxQuantity, Math.floor(Number(e.target.value) || 1))))}
            />
          </label>
        </div>
        <p className={blocked ? "gg-tc-pick__estimate gg-tc-pick__estimate--blocked" : "gg-tc-pick__estimate"} aria-live="polite">
          {estimate !== null ? (
            <>
              About <strong>{formatCents(estimate)}</strong> each{" "}
              <span className="gg-tc-line__meta">
                ({formatCents(reference)} market price{pct !== 100 ? ` × ${pct}% for ${CONDITION_NAMES[condition]}` : ""})
              </span>
            </>
          ) : (
            <>No current market price for this finish. We&rsquo;ll value it by hand when we review your list.</>
          )}
          {blocked && <span className="gg-tc-pick__why">{eligibilityMessage(eligibility, trade.minCardValueCents)}.</span>}
        </p>
        <div className="gg-tc-pick__actions">
          <button
            type="button"
            className="gg-btn"
            disabled={saving || blocked}
            onClick={() => onAdd({ scryfallId: printing.scryfallId, finish, condition, quantity })}
          >
            {saving ? "Adding…" : "Add to my cards"}
          </button>
          <button type="button" className="gg-btn gg-btn-ghost" onClick={onCancel} disabled={saving}>
            Pick a different card
          </button>
        </div>
      </div>
    </div>
  );
}

function OfferCardRow({
  card,
  trade,
  editable,
  saving,
  onQuantity,
  onCondition,
  onRemove,
}: {
  card: TradeOfferCard;
  trade: CustomerTrade;
  editable: boolean;
  saving: boolean;
  onQuantity: (quantity: number) => void;
  onCondition: (condition: CardConditionCode) => void;
  onRemove: () => void;
}) {
  const blocked = BLOCKING_ELIGIBILITY.has(card.eligibility);
  const lineEstimate = card.estimatedUnitCents !== null ? card.estimatedUnitCents * card.quantity : null;
  const reviewed = card.reviewStatus !== "pending";
  return (
    <li className={blocked ? "gg-tc-line gg-tc-line--blocked" : "gg-tc-line"}>
      {card.imageUrl ? (
        <img className="gg-tc-line__img" src={card.imageUrl} alt="" loading="lazy" />
      ) : (
        <span className="gg-tc-line__img gg-tc-line__img--blank" aria-hidden="true" />
      )}
      <span className="gg-tc-line__main">
        <span className="gg-tc-line__name">{card.cardName}</span>
        <span className="gg-tc-line__meta">{printingLabel(card)}</span>
        <span className="gg-tc-line__condition">
          {editable ? (
            <select
              className="gg-tc-inline-select"
              aria-label={`Condition of ${card.cardName}`}
              value={card.reportedCondition}
              disabled={saving}
              onChange={(e) => onCondition(e.target.value as CardConditionCode)}
            >
              {CARD_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_NAMES[c]}
                </option>
              ))}
            </select>
          ) : (
            CONDITION_NAMES[card.reportedCondition]
          )}
        </span>
        <span className="gg-tc-line__value">
          {card.referencePriceCents !== null ? (
            <>
              Market {formatCents(card.referencePriceCents)}
              {card.conditionPercent !== 100 ? ` × ${card.conditionPercent}%` : ""} = {formatCents(card.estimatedUnitCents)} each
            </>
          ) : (
            "Valued by hand at review"
          )}
        </span>
        {card.eligibility !== "eligible" && !reviewed && (
          <span className={blocked ? "gg-tc-flag gg-tc-flag--bad" : "gg-tc-flag"}>
            {eligibilityMessage(card.eligibility, trade.minCardValueCents)}
            {blocked && editable ? ". Take it off to send your list." : ""}
          </span>
        )}
        {reviewed && <ReviewNote card={card} beforeShipping={trade.status === "awaiting_shipment"} />}
      </span>
      <span className="gg-tc-line__qty">
        {editable ? (
          <select
            aria-label={`How many ${card.cardName}`}
            value={card.quantity}
            disabled={saving}
            onChange={(e) => onQuantity(Number(e.target.value))}
          >
            {Array.from({ length: TRADE_LIMITS.maxQuantity }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <span>× {card.quantity}</span>
        )}
      </span>
      <span className="gg-tc-line__price">
        <LineValue card={card} blocked={blocked} lineEstimate={lineEstimate} />
      </span>
      {editable && (
        <button type="button" className="gg-tc-line__remove" disabled={saving} onClick={onRemove} aria-label={`Remove ${card.cardName}`}>
          Remove
        </button>
      )}
    </li>
  );
}

/** The line's value as it stands: final after inspection, approved after review, else the estimate. */
function LineValue({ card, blocked, lineEstimate }: { card: TradeOfferCard; blocked: boolean; lineEstimate: number | null }) {
  if (card.inspected) {
    const qty = card.finalQuantity ?? 0;
    return qty > 0 ? (
      <>
        <strong>{formatCents(qty * (card.finalUnitCents ?? 0))}</strong>
        <span className="gg-tc-line__each">final</span>
      </>
    ) : (
      <span className="gg-tc-line__each">Not taken</span>
    );
  }
  if (card.reviewStatus === "approved") {
    return (
      <>
        <strong>{formatCents((card.approvedQuantity ?? 0) * (card.approvedUnitCents ?? 0))}</strong>
        <span className="gg-tc-line__each">approved</span>
      </>
    );
  }
  if (card.reviewStatus === "rejected") return <span className="gg-tc-line__each">Not taken</span>;
  if (blocked) return <span className="gg-tc-line__each">Not counted</span>;
  if (lineEstimate === null) return <span className="gg-tc-line__each">By hand</span>;
  return (
    <>
      <strong>{formatCents(lineEstimate)}</strong>
      <span className="gg-tc-line__each">estimated</span>
    </>
  );
}

function ReviewNote({ card, beforeShipping }: { card: TradeOfferCard; beforeShipping: boolean }) {
  if (card.inspected) {
    const accepted = card.finalQuantity ?? 0;
    return (
      <span className={accepted > 0 ? "gg-tc-review gg-tc-review--ok" : "gg-tc-review gg-tc-review--no"}>
        {accepted > 0
          ? `Final: ${accepted} × ${formatCents(card.finalUnitCents ?? 0)}${card.verifiedCondition && card.verifiedCondition !== card.reportedCondition ? ` (we graded it ${CONDITION_NAMES[card.verifiedCondition]})` : ""}`
          : "Not accepted after inspection"}
        {card.flags.length > 0 && ` · ${card.flags.join(", ")}`}
        {card.inspectionNote && <span className="gg-tc-review__note">{card.inspectionNote}</span>}
      </span>
    );
  }
  return (
    <span className={card.reviewStatus === "approved" ? "gg-tc-review gg-tc-review--ok" : "gg-tc-review gg-tc-review--no"}>
      {card.reviewStatus === "approved"
        ? `Approved: ${card.approvedQuantity} × ${formatCents(card.approvedUnitCents ?? 0)}`
        : beforeShipping
          ? "Not accepted: please leave it out"
          : "Not accepted"}
      {card.reviewNote && <span className="gg-tc-review__note">{card.reviewNote}</span>}
    </span>
  );
}

