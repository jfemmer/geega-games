import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime } from "../../utils/format";
import { tradeCenterRepository, type InspectCardInput, type TradeAuthenticity } from "../../repositories/tradeCenter.supabase";
import { CARD_CONDITIONS, CONDITION_NAMES, type CardConditionCode, type StaffTradeOfferCard } from "../../../store/lib/tradeCenter";
import {
  AUTHENTICITY_LABELS,
  TRADE_CARD_FLAGS,
  finalOfferPreview,
  inspectChanged,
  inspectDraftOf,
  inspectInput,
  parseUnitCents,
  quantityOptions,
  updateInspectDraft,
  type InspectDraft,
} from "./tradeMath";
import { OfferCardHead } from "./TradeCardBits";
import type { TradePanelProps } from "./types";

// Received / under inspection: for each card we approved, how many arrived,
// whether it's real, the condition we see, how many we take and what each
// is worth now (a new condition rescales the value by the trade's condition
// percentages; staff can type over it). Then the final offer, worked out
// from what's saved, optionally with cash for credit beyond the order.

export function TradeInspectionPanel({ trade, settings, busy, run }: TradePanelProps) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, InspectDraft>>({});
  const [cashForExcess, setCashForExcess] = useState(false);

  const approved = trade.offered.filter((c) => c.reviewStatus === "approved");
  const notApproved = trade.offered.filter((c) => c.reviewStatus !== "approved");
  const draftOf = (c: StaffTradeOfferCard) => drafts[c.id] ?? inspectDraftOf(c);
  const change = (c: StaffTradeOfferCard, patch: Partial<InspectDraft>) =>
    setDrafts((prev) => ({ ...prev, [c.id]: updateInspectDraft(c, prev[c.id] ?? inspectDraftOf(c), patch, trade.conditionPercents) }));

  const changed = approved.filter((c) => inspectChanged(c, draftOf(c)));
  const uninspected = approved.filter((c) => !c.inspected);
  const preview = finalOfferPreview(trade, settings);

  async function saveInspection() {
    const inputs: InspectCardInput[] = [];
    for (const c of changed) {
      const input = inspectInput(c, draftOf(c));
      if ("problem" in input) {
        toast.error(input.problem);
        return;
      }
      inputs.push(input);
    }
    if (inputs.length === 0) return;
    if (await run("inspect", () => tradeCenterRepository.inspect(trade.id, inputs), "Inspection saved.")) setDrafts({});
  }

  async function confirmRest() {
    if (changed.length > 0) {
      toast.error("Save your changes first, or they'd be replaced.");
      return;
    }
    await run(
      "confirm",
      () => tradeCenterRepository.confirmAsDescribed(trade.id),
      uninspected.length === approved.length ? "Every card confirmed as approved." : "The rest confirmed as approved.",
    );
  }

  async function sendFinalOffer() {
    const cash = cashForExcess && preview.cashOptionCents > 0;
    await run(
      "final",
      () => tradeCenterRepository.sendFinalOffer(trade.id, cash),
      "Final offer sent.",
    );
  }

  const finalBlocker =
    changed.length > 0
      ? "Save the inspection first."
      : uninspected.length > 0
        ? `Inspect the ${uninspected.length === 1 ? "last card" : `other ${uninspected.length} cards`}, or confirm ${uninspected.length === 1 ? "it" : "them"} as approved.`
        : null;

  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-inspect-title">
      <div className="gg-trd__sectionhead">
        <h3 id="gg-trd-inspect-title">Inspect their cards</h3>
        {uninspected.length > 0 && (
          <Button size="sm" variant="secondary" icon="checkCircle" onClick={confirmRest} loading={busy === "confirm"} disabled={busy !== null}>
            {uninspected.length === approved.length
              ? "Everything arrived as approved"
              : uninspected.length === 1
                ? "The other card arrived as approved"
                : `The other ${uninspected.length} cards arrived as approved`}
          </Button>
        )}
      </div>
      <p className="gg-card-meta">
        Change only the cards that differ from what you approved and save. Then confirm the rest as approved. A different
        condition rescales the value by this trade&rsquo;s condition percentages; you can type over it.
      </p>

      <ul className="gg-trd-cards">
        {approved.map((c) => {
          const d = draftOf(c);
          const unit = parseUnitCents(d.unit);
          const dirty = inspectChanged(c, d);
          return (
            <li key={c.id} className={`gg-trd-card${dirty ? " gg-trd-card--dirty" : ""}`}>
              <OfferCardHead
                card={c}
                minCardValueCents={trade.minCardValueCents}
                showPricing={false}
                aside={
                  <div className="gg-trd-card__approved">
                    <span>
                      Approved {c.approvedQuantity ?? 0} × {formatCents(c.approvedUnitCents ?? 0)}
                    </span>
                    <span className={c.inspected ? "gg-trd-ok" : "gg-card-meta"}>
                      {c.inspected ? (
                        <>
                          <Icon name="check" size={14} /> Inspected{c.inspectedAt ? ` ${formatDateTime(c.inspectedAt)}` : ""}
                        </>
                      ) : (
                        "Not inspected yet"
                      )}
                    </span>
                  </div>
                }
              />
              <div className="gg-trd-inspect">
                <label className="gg-trd-field">
                  <span>Arrived</span>
                  <select
                    className="gg-input"
                    value={d.received}
                    onChange={(e) => change(c, { received: Number(e.target.value) })}
                  >
                    {quantityOptions(0, Math.max(c.quantity, c.approvedQuantity ?? 0, d.received)).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gg-trd-field">
                  <span>Authentic?</span>
                  <select
                    className="gg-input"
                    value={d.authenticity}
                    onChange={(e) => change(c, { authenticity: e.target.value as TradeAuthenticity })}
                  >
                    {(Object.keys(AUTHENTICITY_LABELS) as TradeAuthenticity[]).map((a) => (
                      <option key={a} value={a}>
                        {AUTHENTICITY_LABELS[a]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gg-trd-field">
                  <span>Condition</span>
                  <select
                    className="gg-input"
                    value={d.condition}
                    onChange={(e) => change(c, { condition: e.target.value as CardConditionCode })}
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
                  <select
                    className="gg-input"
                    value={d.accept}
                    disabled={d.authenticity === "counterfeit"}
                    onChange={(e) => change(c, { accept: Number(e.target.value) })}
                  >
                    {quantityOptions(0, d.received).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gg-trd-field">
                  <span>Value each</span>
                  <span className="gg-trd-dollar">
                    <input
                      className="gg-input"
                      inputMode="decimal"
                      value={d.unit}
                      placeholder="0.00"
                      disabled={d.accept === 0}
                      aria-invalid={(d.accept > 0 && unit === null) || undefined}
                      onChange={(e) => change(c, { unit: e.target.value })}
                    />
                  </span>
                </label>
                <div className="gg-trd-field gg-trd-field--total">
                  <span>Counts for</span>
                  <strong>{d.accept === 0 ? formatCents(0) : unit === null ? "—" : formatCents(unit * d.accept)}</strong>
                </div>
              </div>
              <fieldset className="gg-trd-flags">
                <legend className="gg-visually-hidden">Problems with {c.cardName}</legend>
                {TRADE_CARD_FLAGS.map((f) => (
                  <label key={f.value} className="gg-check-inline">
                    <input
                      type="checkbox"
                      checked={d.flags.includes(f.value)}
                      onChange={(e) =>
                        change(c, {
                          flags: e.target.checked ? [...d.flags, f.value] : d.flags.filter((x) => x !== f.value),
                        })
                      }
                    />
                    {f.label}
                  </label>
                ))}
              </fieldset>
              <details className="gg-trd-card__notes" open={Boolean(d.note || d.internalNote) || undefined}>
                <summary>Notes{d.note || d.internalNote ? "" : " (optional)"}</summary>
                <div className="gg-form-grid">
                  <TextField
                    label="Note to the customer"
                    maxLength={1000}
                    value={d.note}
                    placeholder="What changed, and why"
                    onChange={(e) => change(c, { note: e.target.value })}
                  />
                  <TextField
                    label="Staff note"
                    maxLength={2000}
                    value={d.internalNote}
                    placeholder="Only staff see this"
                    onChange={(e) => change(c, { internalNote: e.target.value })}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      {changed.length > 0 && (
        <div className="gg-trd-tally">
          <span>
            <strong>{changed.length}</strong> card{changed.length === 1 ? "" : "s"} changed
          </span>
          <Button size="sm" variant="primary" onClick={saveInspection} loading={busy === "inspect"} disabled={busy !== null}>
            Save the inspection
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDrafts({})} disabled={busy !== null}>
            Undo changes
          </Button>
        </div>
      )}

      {notApproved.length > 0 && (
        <details className="gg-trd-leftout">
          <summary>
            Not approved at review ({notApproved.length})
          </summary>
          <p className="gg-card-meta">The customer was told to leave these out. If any came anyway, mail them back.</p>
          <ul>
            {notApproved.map((c) => (
              <li key={c.id}>
                {c.cardName} <span className="gg-card-meta">× {c.quantity}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="gg-trd-final">
        <h4>Final offer</h4>
        <dl className="gg-trd-money">
          <div>
            <dt>Cards you&rsquo;re taking{preview.uninspected > 0 ? " (inspected so far)" : ""}</dt>
            <dd>{formatCents(preview.valueCents)}</dd>
          </div>
          <div>
            <dt>
              Trade credit at {trade.creditRatePercent}%
              {trade.processingFeeCents ? `, less ${formatCents(trade.processingFeeCents)} fee` : ""}
            </dt>
            <dd>{formatCents(preview.creditCents)}</dd>
          </div>
          <div>
            <dt>Our cards</dt>
            <dd>{formatCents(preview.wantedCents)}</dd>
          </div>
          <div>
            <dt>Our cards the credit doesn&rsquo;t cover</dt>
            <dd>{formatCents(preview.cardBalanceCents)}</dd>
          </div>
          <div>
            <dt>Shipping our cards (paid by card, not credit)</dt>
            <dd>{preview.shippingCents === 0 ? "Free" : formatCents(preview.shippingCents)}</dd>
          </div>
          <div className="gg-trd-money__total">
            <dt>{preview.dueCents > 0 ? "They pay by card" : "Nothing to pay by card"}</dt>
            <dd>{formatCents(preview.dueCents)}</dd>
          </div>
          {preview.excessCents > 0 && (
            <div>
              <dt>Credit left over</dt>
              <dd>{formatCents(preview.excessCents)}</dd>
            </div>
          )}
        </dl>
        {preview.cashOptionCents > 0 && (
          <label className="gg-check-inline gg-trd-cash">
            <input type="checkbox" checked={cashForExcess} onChange={(e) => setCashForExcess(e.target.checked)} />
            Offer {formatCents(preview.cashOptionCents)} cash for the credit left over instead ({settings.cashRatePercent}% cash
            rate). You pay it by hand once the trade is done.
          </label>
        )}
        {finalBlocker && (
          <p className="gg-trd-blocker" role="note">
            <Icon name="info" size={16} /> {finalBlocker}
          </p>
        )}
        <div className="gg-drawer-actions__buttons">
          <Button variant="primary" onClick={sendFinalOffer} loading={busy === "final"} disabled={busy !== null || finalBlocker !== null}>
            Send the final offer
          </Button>
        </div>
        <p className="gg-card-meta">
          The customer is emailed what changed and can accept it, ask for an adjustment, or decline (their cards come back).
        </p>
      </div>
    </section>
  );
}
