import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime } from "../../utils/format";
import { sortingRepository } from "../../repositories/sorting.supabase";
import type { SortingRequestDetail } from "../../types";
import {
  SORTING_MANUAL_PAYMENT_METHODS,
  SORTING_PAYMENT_METHOD_LABELS,
  parseDollarsToCents,
} from "../../../store/lib/sortingService";

// Payments against the approved quote. Card payments made from the quote
// page are recorded automatically (once each, whether the page or Stripe's
// webhook reports them first); staff record anything paid in person here.
// A payment can never take the total paid past the approved total.

export function SortingPaymentsPanel({
  detail,
  onChanged,
}: {
  detail: SortingRequestDetail;
  onChanged: () => void;
}) {
  const toast = useToast();
  const accepted = detail.acceptedQuoteId ? (detail.quotes.find((q) => q.id === detail.acceptedQuoteId) ?? null) : null;
  const total = accepted?.totalCents ?? null;
  const due = total !== null ? Math.max(0, total - detail.amountPaidCents) : 0;
  const overpaid = total !== null && detail.amountPaidCents > total ? detail.amountPaidCents - total : 0;

  const [amount, setAmount] = useState(due > 0 ? (due / 100).toFixed(2) : "");
  const [method, setMethod] = useState<string>("in_store_card");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = parseDollarsToCents(amount);
  const validAmount = cents !== null && cents > 0 && cents <= due;

  async function record() {
    setConfirming(false);
    setError(null);
    try {
      const { emailed } = await sortingRepository.recordPayment(detail.id, { amountCents: cents ?? 0, method, note });
      toast.success(emailed ? "Payment recorded and receipt emailed." : "Payment recorded.");
      setNote("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the payment.");
    }
  }

  return (
    <section className="gg-leaddetail__section gg-sortpay">
      <h3>Payments</h3>
      {total === null ? (
        <p className="gg-card-meta">
          Nothing to pay yet — payments open once the customer approves a quote. Card payments from the quote page are
          recorded here automatically.
        </p>
      ) : (
        <>
          <dl className="gg-sortq__lines gg-sortpay__totals">
            <div>
              <dt>Approved total</dt>
              <dd>{formatCents(total)}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>{formatCents(detail.amountPaidCents)}</dd>
            </div>
            <div className="gg-sortpay__due">
              <dt>{overpaid > 0 ? "Overpaid" : "Balance due"}</dt>
              <dd>{overpaid > 0 ? formatCents(overpaid) : due > 0 ? formatCents(due) : "Paid in full"}</dd>
            </div>
          </dl>
          {overpaid > 0 && (
            <p className="gg-sortq__warn">
              The customer has paid more than the approved total (a lower revised quote was approved after they paid).
              Refund the difference in Stripe, or in person, and note it below.
            </p>
          )}
        </>
      )}

      {detail.payments.length > 0 && (
        <ul className="gg-sortpay__list">
          {detail.payments.map((p) => (
            <li key={p.id}>
              <span>
                {formatDateTime(p.createdAt)} · {SORTING_PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                {p.note ? ` · ${p.note}` : ""}
                {p.providerReference ? <span className="gg-card-meta"> · {p.providerReference}</span> : null}
              </span>
              <strong>{formatCents(p.amountCents)}</strong>
            </li>
          ))}
        </ul>
      )}

      {total !== null && due > 0 && (
        <div className="gg-sortpay__form">
          <span className="gg-sortq__label">Record a payment made in person</span>
          <div className="gg-form-grid">
            <TextField
              label="Amount ($)"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setError(null);
                setAmount(e.target.value);
              }}
              hint={`Up to ${formatCents(due)}`}
            />
            <SelectField label="Paid by" value={method} onChange={(e) => setMethod(e.target.value)}>
              {SORTING_MANUAL_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {SORTING_PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </SelectField>
          </div>
          <TextField label="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          {error && (
            <p className="gg-sortq__error" role="alert">
              {error}
            </p>
          )}
          <div className="gg-drawer-actions__buttons">
            <Button
              variant="primary"
              size="sm"
              icon="dollar"
              disabled={!validAmount}
              onClick={() => setConfirming(true)}
            >
              Record payment
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Record this payment?"
        message={`Record ${cents !== null ? formatCents(cents) : "—"} paid by ${SORTING_PAYMENT_METHOD_LABELS[method as keyof typeof SORTING_PAYMENT_METHOD_LABELS] ?? method}? The customer gets an email receipt. Payments can't be edited afterwards.`}
        confirmLabel="Record payment"
        onConfirm={record}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
