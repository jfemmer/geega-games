import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { useToast } from "../../hooks/useToast";
import { useNow } from "../../../store/lib/useNow";
import { formatCents } from "../../utils/format";
import { tradeCenterRepository, type ReviewCardInput } from "../../repositories/tradeCenter.supabase";
import { formatDeadline, tradeComparison, type StaffTradeOfferCard } from "../../../store/lib/tradeCenter";
import { DEPOSIT_REASON_LABELS, type DepositOverride } from "../../../store/lib/tradeRules";
import {
  centsInput,
  confirmByPreview,
  depositPreview,
  parseUnitCents,
  quantityOptions,
  reviewChanged,
  reviewDraftOf,
  reviewInput,
  reviewTally,
  type ReviewDraft,
} from "./tradeMath";
import { OfferCardHead } from "./TradeCardBits";
import type { TradePanelProps } from "./types";

// Pending review: staff approve (how many, and the value each) or reject
// each of the customer's cards, then approve the trade (the customer then
// has the confirmation window to confirm, with the deposit shown here), ask
// the customer for changes, or reject it. Nothing is reserved until the
// customer confirms. Card decisions are saved with whichever of those staff
// pick, or on their own.

type Outcome = "approve" | "revise" | "reject";

export function TradeReviewPanel({ trade, settings, busy, run }: TradePanelProps) {
  const toast = useToast();
  // Only the cards staff have touched; everything else shows what's saved.
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [outcome, setOutcome] = useState<Outcome>("approve");
  const [override, setOverride] = useState<DepositOverride>(trade.deposit.override);
  const [conditions, setConditions] = useState("");
  const [revision, setRevision] = useState("");
  const [reason, setReason] = useState("");
  const now = useNow();
  const confirmBy = confirmByPreview(settings, now);
  const deposit = depositPreview(trade, settings, override);
  const shipDays = trade.privileges?.shipDays ?? settings.shipDaysNew;
  const shortLines = trade.wanted.filter((w) => w.status === "requested" && w.available !== null && w.available < w.quantity);

  const cards = trade.offered;
  const draftOf = (c: StaffTradeOfferCard) => drafts[c.id] ?? reviewDraftOf(c);
  const change = (c: StaffTradeOfferCard, patch: Partial<ReviewDraft>) =>
    setDrafts((prev) => ({ ...prev, [c.id]: { ...(prev[c.id] ?? reviewDraftOf(c)), ...patch } }));

  const changed = cards.filter((c) => reviewChanged(c, draftOf(c)));
  const tally = reviewTally(cards, drafts);
  const undecidedWithEstimate = cards.filter((c) => draftOf(c).decision === "pending" && c.estimatedUnitCents != null);
  const preview = tradeComparison({
    wantedCents: trade.wantedTotalCents,
    offeredValueCents: tally.approvedValueCents,
    ratePercent: trade.creditRatePercent,
    feeCents: trade.processingFeeCents,
  });

  /** The changed cards as the review sends them, or null (and a message) if one isn't ready. */
  function changedInputs(): ReviewCardInput[] | null {
    const inputs: ReviewCardInput[] = [];
    for (const c of changed) {
      const input = reviewInput(c, draftOf(c));
      if ("problem" in input) {
        toast.error(input.problem);
        return null;
      }
      inputs.push(input);
    }
    return inputs;
  }

  async function saveReview() {
    const inputs = changedInputs();
    if (!inputs || inputs.length === 0) return;
    if (await run("review", () => tradeCenterRepository.review(trade.id, inputs), "Review saved.")) setDrafts({});
  }

  async function finish() {
    const inputs = changedInputs();
    if (!inputs) return;
    const saveFirst = async () => {
      if (inputs.length > 0) await tradeCenterRepository.review(trade.id, inputs);
    };
    let ok = false;
    if (outcome === "approve") {
      ok = await run(
        "approve",
        async () => {
          await saveFirst();
          return tradeCenterRepository.approve(trade.id, {
            conditions: conditions.trim(),
            ...(override !== trade.deposit.override ? { depositOverride: override } : {}),
          });
        },
        "Approved: waiting for the customer to confirm.",
      );
    } else if (outcome === "revise") {
      if (!revision.trim()) {
        toast.error("Tell the customer what to change.");
        return;
      }
      ok = await run(
        "revise",
        async () => {
          await saveFirst();
          return tradeCenterRepository.requestRevision(trade.id, revision.trim());
        },
        "Sent back with your message.",
      );
    } else {
      if (!reason.trim()) {
        toast.error("Give the customer a reason.");
        return;
      }
      ok = await run("reject", () => tradeCenterRepository.reject(trade.id, reason.trim()), "Trade rejected.");
    }
    if (ok) setDrafts({});
  }

  function approveRestAtEstimate() {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const c of undecidedWithEstimate) {
        next[c.id] = { ...(prev[c.id] ?? reviewDraftOf(c)), decision: "approved", quantity: c.quantity, unit: centsInput(c.estimatedUnitCents) };
      }
      return next;
    });
  }

  const approveBlocker =
    !settings.shipTo
      ? "Add the address customers mail their cards to (Settings) before approving."
      : tally.pending > 0
        ? `Approve or reject every card first (${tally.pending} left).`
        : tally.approved === 0
          ? "Approve at least one card, or reject the trade."
          : shortLines.length > 0
            ? `Some of our cards sold since the customer picked them (${shortLines.map((w) => w.cardName).join(", ")}). Lower or take them off under Our cards, or ask the customer to pick again.`
            : null;

  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-review-title">
      <div className="gg-trd__sectionhead">
        <h3 id="gg-trd-review-title">Review their cards</h3>
        {undecidedWithEstimate.length > 0 && (
          <Button size="sm" variant="secondary" icon="check" onClick={approveRestAtEstimate} disabled={busy !== null}>
            Approve the rest at their estimates
          </Button>
        )}
      </div>
      <p className="gg-card-meta">
        Values default to the estimate (market price × their condition&rsquo;s percentage). Cards with no market price need a
        value typed in. Notes to the customer show on their trade page and in the email.
      </p>

      <ul className="gg-trd-cards">
        {cards.map((c) => {
          const d = draftOf(c);
          const unit = parseUnitCents(d.unit);
          return (
            <li key={c.id} className={`gg-trd-card gg-trd-card--${d.decision}`}>
              <OfferCardHead card={c} minCardValueCents={trade.minCardValueCents} />
              <div className="gg-trd-card__controls">
                <div className="gg-trd-seg" role="group" aria-label={`Decision for ${c.cardName}`}>
                  <button
                    type="button"
                    aria-pressed={d.decision === "approved"}
                    className="gg-trd-seg__btn gg-trd-seg__btn--yes"
                    onClick={() => change(c, { decision: "approved" })}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    aria-pressed={d.decision === "rejected"}
                    className="gg-trd-seg__btn gg-trd-seg__btn--no"
                    onClick={() => change(c, { decision: "rejected" })}
                  >
                    Reject
                  </button>
                </div>
                {d.decision === "approved" && (
                  <div className="gg-trd-card__amounts">
                    <label className="gg-trd-inline">
                      <span>Take</span>
                      <select
                        className="gg-input gg-trd-qty"
                        aria-label={`How many ${c.cardName} to approve`}
                        value={d.quantity}
                        onChange={(e) => change(c, { quantity: Number(e.target.value) })}
                      >
                        {quantityOptions(1, c.quantity).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <span>of {c.quantity} at</span>
                    </label>
                    <label className="gg-trd-inline">
                      <span className="gg-trd-dollar">
                        <input
                          className="gg-input"
                          inputMode="decimal"
                          aria-label={`Value each for ${c.cardName}`}
                          value={d.unit}
                          placeholder="0.00"
                          aria-invalid={unit === null || undefined}
                          onChange={(e) => change(c, { unit: e.target.value })}
                        />
                      </span>
                      <span>each</span>
                    </label>
                    <strong className="gg-trd-card__total">{unit === null ? "—" : formatCents(unit * d.quantity)}</strong>
                  </div>
                )}
                {d.decision === "pending" && <span className="gg-trd-card__undecided">Not decided yet</span>}
              </div>
              <details className="gg-trd-card__notes" open={Boolean(d.reviewNote || d.internalNote) || undefined}>
                <summary>
                  Notes{d.reviewNote || d.internalNote ? "" : " (optional)"}
                </summary>
                <div className="gg-form-grid">
                  <TextField
                    label="Note to the customer"
                    maxLength={1000}
                    value={d.reviewNote}
                    placeholder={d.decision === "rejected" ? "Why, in a few words" : "Optional"}
                    onChange={(e) => change(c, { reviewNote: e.target.value })}
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

      <div className="gg-trd-tally" aria-live="polite">
        <span>
          <strong>{tally.approved}</strong> approved
        </span>
        <span>
          <strong>{tally.rejected}</strong> rejected
        </span>
        <span>
          <strong>{tally.pending}</strong> not decided
        </span>
        {changed.length > 0 && (
          <Button size="sm" variant="secondary" onClick={saveReview} loading={busy === "review"} disabled={busy !== null}>
            Save the review ({changed.length} changed)
          </Button>
        )}
      </div>

      <dl className="gg-trd-money gg-trd-money--preview">
        <div>
          <dt>Approved value</dt>
          <dd>{formatCents(tally.approvedValueCents)}</dd>
        </div>
        <div>
          <dt>Trade credit at {trade.creditRatePercent}%{trade.processingFeeCents ? `, less ${formatCents(trade.processingFeeCents)} fee` : ""}</dt>
          <dd>{formatCents(preview.creditCents)}</dd>
        </div>
        <div>
          <dt>Our cards and shipping</dt>
          <dd>{formatCents(preview.wantedCents + preview.shippingCents)}</dd>
        </div>
        <div className="gg-trd-money__total">
          <dt>{preview.remainingCents > 0 ? "They would pay" : "Store credit left over"}</dt>
          <dd>{formatCents(preview.remainingCents > 0 ? preview.remainingCents : preview.excessCents)}</dd>
        </div>
      </dl>

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
              The customer is emailed the approval and has until <strong>{formatDeadline(new Date(confirmBy).toISOString())}</strong> to
              confirm ({settings.confirmationHours} hours; Sundays don&rsquo;t count). Nothing is reserved until they confirm. Once they do,
              they get your mailing address and {shipDays} day{shipDays === 1 ? "" : "s"} to ship.
            </p>
            <div className="gg-form-grid">
              <SelectField
                label="Deposit"
                value={override}
                onChange={(e) => setOverride(e.target.value === "required" ? "required" : e.target.value === "waived" ? "waived" : "auto")}
                hint={
                  !settings.depositsEnabled
                    ? "Deposits are off in Settings, so none is asked for."
                    : deposit.cents > 0
                      ? `${formatCents(deposit.cents)}: ${deposit.reason ? DEPOSIT_REASON_LABELS[deposit.reason].toLowerCase() : "required"}. Refunded in full once the carrier accepts their package in time.`
                      : "No deposit on this trade."
                }
              >
                <option value="auto">Automatic (from Settings and their record)</option>
                <option value="required">Require a deposit</option>
                <option value="waived">No deposit</option>
              </SelectField>
            </div>
            <TextArea
              label="Conditions (optional)"
              rows={2}
              maxLength={2000}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              hint="Anything the approval depends on, such as “Sheoldred must be Near Mint, or it's valued at Lightly Played.”"
            />
            {approveBlocker && (
              <p className="gg-trd-blocker" role="note">
                <Icon name="info" size={16} /> {approveBlocker}
              </p>
            )}
            <div className="gg-drawer-actions__buttons">
              <Button variant="primary" onClick={finish} loading={busy === "approve"} disabled={busy !== null || approveBlocker !== null}>
                {changed.length > 0 ? "Save the review and approve" : "Approve and email the customer"}
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
                {changed.length > 0 ? "Save the review and send it back" : "Send it back to the customer"}
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
