import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { SelectField, TextArea } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { formatCents, formatDateTime } from "../../utils/format";
import { tradeCenterRepository } from "../../repositories/tradeCenter.supabase";
import { DEPOSIT_STATUS_ADMIN_LABELS, type StaffTrade } from "../../../store/lib/tradeCenter";
import { DEPOSIT_REASON_LABELS, type DepositOverride } from "../../../store/lib/tradeRules";
import { DEPOSIT_STATUS_TONE } from "./tradeLabels";
import { depositPreview } from "./tradeMath";
import type { TradePanelProps } from "./types";

// The refundable deposit on a trade, for staff: what's required and why,
// where the money is (Stripe's payment and refund), what the customer agreed
// to, and what staff can do now: change the requirement before it's paid,
// refund it, keep it (the store owner, with keeping deposits turned on in
// Settings, after reviewing the case: never automatically), or retry a
// refund the bank refused. Also the customer's proof of shipping.

/** The requirement can change after approval and before it's paid. */
const CHANGEABLE = new Set(["awaiting_confirmation", "awaiting_deposit"]);

export function TradeDepositPanel({ trade, settings, owner, busy, run }: TradePanelProps) {
  const d = trade.deposit;
  const [override, setOverride] = useState<DepositOverride>(d.override);
  const [action, setAction] = useState<null | "refund" | "keep">(null);
  const [note, setNote] = useState("");
  const canChange = CHANGEABLE.has(trade.status) && d.paidCents === null;
  if (d.status === "not_required" && d.cents === 0 && !canChange && trade.consents.length === 0) return null;

  const preview = depositPreview(trade, settings, override);
  const amount = d.paidCents ?? d.cents;
  const canRefund = d.status === "paid" || d.status === "forfeiture_review" || d.status === "forfeited";
  const canKeep = d.status === "forfeiture_review";
  const keepBlocker = !settings.allowForfeiture
    ? "Keeping deposits is turned off in Settings, so this one can only be refunded."
    : !owner
      ? "Only the store owner can keep a deposit."
      : null;

  async function decide(kind: "refund" | "keep") {
    const text = note.trim();
    const ok =
      kind === "refund"
        ? await run("deposit", () => tradeCenterRepository.refundDeposit(trade.id, text), `Refunding ${formatCents(amount)}.`)
        : await run("deposit", () => tradeCenterRepository.forfeitDeposit(trade.id, text), "Deposit kept.");
    if (ok) {
      setAction(null);
      setNote("");
    }
  }

  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-deposit-title">
      <div className="gg-trd__sectionhead">
        <h3 id="gg-trd-deposit-title">Deposit</h3>
        <Badge tone={DEPOSIT_STATUS_TONE[d.status]}>{DEPOSIT_STATUS_ADMIN_LABELS[d.status]}</Badge>
      </div>
      <dl className="gg-trd-money">
        <div>
          <dt>Required</dt>
          <dd>{d.cents > 0 ? formatCents(d.cents) : "None"}</dd>
        </div>
        {d.paidCents !== null && (
          <div>
            <dt>Paid{d.paidAt ? ` ${formatDateTime(d.paidAt)}` : ""}</dt>
            <dd>{formatCents(d.paidCents)}</dd>
          </div>
        )}
        {d.feeCents !== null && (
          <div>
            <dt>Stripe&rsquo;s fee (yours to absorb; refunds are always in full)</dt>
            <dd>{formatCents(d.feeCents)}</dd>
          </div>
        )}
        {d.refundedAt && (
          <div>
            <dt>Refunded {formatDateTime(d.refundedAt)}</dt>
            <dd>{formatCents(amount)}</dd>
          </div>
        )}
      </dl>
      {d.reason && (
        <p className="gg-card-meta">
          Why: {DEPOSIT_REASON_LABELS[d.reason]}
          {d.override !== "auto" ? ` (set by staff: ${d.override === "required" ? "required" : "waived"})` : ""}.
        </p>
      )}
      {d.paymentIntentId && (
        <p className="gg-card-meta">
          Stripe payment <code>{d.paymentIntentId}</code>
          {d.refundId ? (
            <>
              {" "}
              · refund <code>{d.refundId}</code>
            </>
          ) : null}
          {d.refundAttempts > 1 ? ` · ${d.refundAttempts} refund attempts` : ""}
        </p>
      )}
      {d.status === "payment_pending" && trade.status === "awaiting_deposit" && (
        <p className="gg-card-meta">The customer agreed to the terms and is paying. Our cards are reserved the moment it goes through.</p>
      )}
      {d.status === "refund_pending" && (
        <p className="gg-card-meta">
          Refund on its way{d.refundRequestedAt ? ` since ${formatDateTime(d.refundRequestedAt)}` : ""}. Stripe confirms it here; the
          customer&rsquo;s bank can take 5 to 10 business days to show it.
        </p>
      )}
      {d.status === "refund_failed" && (
        <p className="gg-trd-blocker" role="alert">
          <Icon name="warning" size={16} /> The refund didn&rsquo;t go through{d.refundFailure ? `: ${d.refundFailure}` : ""}. Try again, or
          contact the customer to refund another way.
        </p>
      )}
      {d.status === "forfeiture_review" && (
        <p className="gg-trd-blocker" role="note">
          <Icon name="info" size={16} /> Under review: the customer canceled after confirming or didn&rsquo;t ship in time. Refund it, or
          keep it under the terms they agreed to. Nothing happens until you decide.
        </p>
      )}
      {d.decisionNote && (
        <p className="gg-card-meta">
          Decided{d.decidedAt ? ` ${formatDateTime(d.decidedAt)}` : ""}
          {d.decidedBy ? ` by ${d.decidedBy}` : ""}: {d.decisionNote}
        </p>
      )}

      {(canRefund || d.status === "refund_failed") && (
        <div className="gg-trd-form">
          {action === null ? (
            <div className="gg-drawer-actions__buttons">
              {canRefund && (
                <Button size="sm" variant={canKeep ? "primary" : "secondary"} icon="dollar" disabled={busy !== null} onClick={() => setAction("refund")}>
                  {d.status === "forfeited" ? "Refund it after all…" : `Refund ${formatCents(amount)} in full…`}
                </Button>
              )}
              {canKeep && (
                <Button size="sm" variant="danger" disabled={busy !== null || keepBlocker !== null} onClick={() => setAction("keep")}>
                  Keep the deposit…
                </Button>
              )}
              {d.status === "refund_failed" && (
                <Button
                  size="sm"
                  variant="primary"
                  icon="swap"
                  loading={busy === "deposit"}
                  disabled={busy !== null}
                  onClick={() => void run("deposit", () => tradeCenterRepository.retryRefund(trade.id), "Trying the refund again.")}
                >
                  Try the refund again
                </Button>
              )}
            </div>
          ) : (
            <>
              <TextArea
                label={action === "keep" ? "Why you're keeping it (the customer is emailed this)" : "Note (optional)"}
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                hint={
                  action === "keep"
                    ? "Only when the terms they agreed to allow it. Their record already counts the cancellation or missed deadline."
                    : "The full amount goes back to the card they paid with, and the customer is emailed."
                }
              />
              <div className="gg-drawer-actions__buttons">
                <Button variant="ghost" size="sm" onClick={() => setAction(null)} disabled={busy !== null}>
                  Cancel
                </Button>
                <Button
                  variant={action === "keep" ? "danger" : "primary"}
                  size="sm"
                  loading={busy === "deposit"}
                  disabled={busy !== null || (action === "keep" && !note.trim())}
                  onClick={() => void decide(action)}
                >
                  {action === "keep" ? `Keep the ${formatCents(amount)} deposit` : `Refund ${formatCents(amount)}`}
                </Button>
              </div>
            </>
          )}
          {canKeep && keepBlocker && <p className="gg-card-meta">{keepBlocker}</p>}
        </div>
      )}

      {canChange && (
        <div className="gg-trd-form">
          <SelectField
            label="Change the deposit"
            value={override}
            onChange={(e) => setOverride(e.target.value === "required" ? "required" : e.target.value === "waived" ? "waived" : "auto")}
            hint={
              !settings.depositsEnabled
                ? "Deposits are off in Settings."
                : preview.cents > 0
                  ? `Would be ${formatCents(preview.cents)}. The customer is told by email; if they're paying right now, that payment is canceled and they confirm again.`
                  : "Would be none. The customer is told by email and can confirm without paying."
            }
          >
            <option value="auto">Automatic (from Settings and their record)</option>
            <option value="required">Require a deposit</option>
            <option value="waived">No deposit</option>
          </SelectField>
          <div className="gg-drawer-actions__buttons">
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "setDeposit"}
              disabled={busy !== null || (override === d.override && preview.cents === d.cents)}
              onClick={() => void run("setDeposit", () => tradeCenterRepository.setDeposit(trade.id, override), "Deposit updated.")}
            >
              Save the deposit
            </Button>
          </div>
        </div>
      )}

      {trade.consents.length > 0 && <Consents trade={trade} />}
    </section>
  );
}

/** Exactly what the customer agreed to, when, and from where (each confirmation). */
function Consents({ trade }: { trade: StaffTrade }) {
  return (
    <details className="gg-trd-consents">
      <summary>What the customer agreed to ({trade.consents.length})</summary>
      <ul className="gg-trd-plain">
        {trade.consents.map((c) => (
          <li key={c.createdAt}>
            <p>
              <strong>{formatDateTime(c.createdAt)}</strong> · terms version {c.termsVersion} · deposit {c.depositCents > 0 ? formatCents(c.depositCents) : "none"}
              {c.shipDays ? ` · ${c.shipDays} days to ship` : ""}
            </p>
            <p className="gg-card-meta">
              {c.ip ? `IP ${c.ip}` : "IP not recorded"}
              {c.userAgent ? ` · ${c.userAgent}` : ""}
            </p>
            <blockquote className="gg-trd-terms">{c.termsText}</blockquote>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Proof of shipping the customer sent, and deciding on it. */
export function TradeDisputesPanel({ trade, busy, run }: TradePanelProps) {
  const [note, setNote] = useState("");
  if (trade.disputes.length === 0) return null;
  const hasOpen = trade.disputes.some((d) => d.status === "open");

  async function decide(disputeId: string, outcome: "accepted" | "rejected") {
    const ok = await run(
      "dispute",
      () => tradeCenterRepository.resolveDispute(trade.id, disputeId, outcome, note.trim()),
      outcome === "accepted" ? "Proof accepted. Now verify the shipment, give more time or reinstate, as fits." : "Proof rejected.",
    );
    if (ok) setNote("");
  }

  return (
    <section className="gg-trd__section" aria-labelledby="gg-trd-disputes-title">
      <h3 id="gg-trd-disputes-title">Proof of shipping ({trade.disputes.length})</h3>
      <ul className="gg-trd-disputes">
        {trade.disputes.map((d) => (
          <li key={d.id} className={`gg-trd-dispute gg-trd-dispute--${d.status}`}>
            <p>
              <strong>{d.status === "open" ? "Waiting for you" : d.status === "accepted" ? "Accepted" : "Rejected"}</strong>
              <span className="gg-card-meta"> · sent {formatDateTime(d.createdAt)}</span>
            </p>
            <p className="gg-trd-card__quote">&ldquo;{d.note}&rdquo;</p>
            {d.files.length > 0 && (
              <ul className="gg-trd-plain">
                {d.files.map((f) => (
                  <li key={`${d.id}-${f.name}`}>
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noopener noreferrer">
                        {f.name}
                      </a>
                    ) : (
                      f.name
                    )}
                    {f.size > 0 && <span className="gg-card-meta"> · {Math.max(1, Math.round(f.size / 1024))} KB</span>}
                  </li>
                ))}
              </ul>
            )}
            {d.status !== "open" && (
              <p className="gg-card-meta">
                {d.resolvedBy ?? "Staff"}
                {d.resolvedAt ? `, ${formatDateTime(d.resolvedAt)}` : ""}
                {d.staffNote ? `: ${d.staffNote}` : ""}
              </p>
            )}
            {d.status === "open" && (
              <div className="gg-trd-form">
                <TextArea label="Note (staff only)" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                <p className="gg-card-meta">
                  Accepting doesn&rsquo;t move a deadline by itself: then verify the shipment, give more time, or reinstate the reservation.
                  Rejecting leaves the deadline as it is.
                </p>
                <div className="gg-drawer-actions__buttons">
                  <Button size="sm" variant="danger" loading={busy === "dispute"} disabled={busy !== null} onClick={() => void decide(d.id, "rejected")}>
                    Reject the proof
                  </Button>
                  <Button size="sm" variant="primary" loading={busy === "dispute"} disabled={busy !== null} onClick={() => void decide(d.id, "accepted")}>
                    Accept the proof
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {hasOpen && <p className="gg-card-meta">File links last 15 minutes; reopen the trade for fresh ones.</p>}
    </section>
  );
}
