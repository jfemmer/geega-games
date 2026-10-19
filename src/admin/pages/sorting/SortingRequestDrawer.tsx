import { useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { SelectField, TextArea, TextField } from "../../components/ui/Field";
import { Spinner } from "../../components/ui/States";
import { useToast } from "../../hooks/useToast";
import { formatCents, formatDateTime } from "../../utils/format";
import { sortingRepository } from "../../repositories/sorting.supabase";
import type { SortingRequestDetail, SortingStatus } from "../../types";
import { SortingQuotePanel } from "./SortingQuotePanel";
import { SortingPaymentsPanel } from "./SortingPaymentsPanel";
import { SORTING_STATUS_TONE } from "./sortingLabels";
import {
  SORTING_DELIVERY_LABELS,
  SORTING_MANUAL_STATUSES,
  SORTING_STATUS_ADMIN_LABELS,
  formatRatePerThousand,
  parseCardCount,
  sortingStatusLabel,
} from "../../../store/lib/sortingService";

// One collection sorting request: who and what, where it ships back to (and
// the exact shipping terms the customer agreed to), its status, the
// itemized quote and the payments. Status changes that the customer waits on
// email them, with an optional message.

/** Statuses whose change emails the customer (api/_lib/sortingEmails.ts). */
const EMAILED_STATUSES = new Set<SortingStatus>(["awaiting_cards", "received", "ready", "returned", "cancelled"]);

export function SortingRequestDrawer({
  detail,
  loading,
  open,
  onClose,
  onChanged,
}: {
  detail: SortingRequestDetail | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={detail ? `Sorting ${detail.referenceNumber}` : "Sorting request"}
      variant="drawer"
      size="lg"
      headerExtra={
        detail ? <Badge tone={SORTING_STATUS_TONE[detail.status]}>{SORTING_STATUS_ADMIN_LABELS[detail.status]}</Badge> : null
      }
    >
      {loading || !detail ? (
        <div className="gg-sortdetail__loading">
          <Spinner label="Loading request" />
        </div>
      ) : (
        <DetailBody key={detail.id} detail={detail} onChanged={onChanged} />
      )}
    </Modal>
  );
}

function DetailBody({ detail, onChanged }: { detail: SortingRequestDetail; onChanged: () => void }) {
  const toast = useToast();
  const shipped = detail.deliveryMethod === "ship";
  const [status, setStatus] = useState<SortingStatus>(detail.status);
  const [message, setMessage] = useState("");
  const [countedCards, setCountedCards] = useState(detail.countedCards != null ? String(detail.countedCards) : "");
  const [carrier, setCarrier] = useState(detail.returnCarrier ?? "");
  const [tracking, setTracking] = useState(detail.returnTrackingNumber ?? "");
  const [notes, setNotes] = useState(detail.internalNotes ?? "");
  const [saving, setSaving] = useState<null | "status" | "notes">(null);

  const statusChanged = status !== detail.status;
  const counted = countedCards.trim() ? parseCardCount(countedCards) : null;
  const countChanged = (counted ?? null) !== (detail.countedCards ?? null);
  const shipChanged = carrier.trim() !== (detail.returnCarrier ?? "") || tracking.trim() !== (detail.returnTrackingNumber ?? "");
  const willEmail = statusChanged && EMAILED_STATUSES.has(status);

  async function saveStatus() {
    if (countedCards.trim() && counted === null) {
      toast.error("Counted cards must be a whole number.");
      return;
    }
    setSaving("status");
    try {
      const { emailed } = await sortingRepository.updateRequest(detail.id, {
        ...(statusChanged ? { status, customerMessage: message.trim() || undefined } : {}),
        ...(countChanged ? { countedCards: counted } : {}),
        ...(shipChanged ? { returnCarrier: carrier, returnTrackingNumber: tracking } : {}),
      });
      toast.success(
        willEmail ? (emailed ? "Saved and emailed the customer." : "Saved, but the email didn't go out.") : "Saved.",
      );
      setMessage("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(null);
    }
  }

  async function saveNotes() {
    setSaving("notes");
    try {
      await sortingRepository.updateRequest(detail.id, { internalNotes: notes });
      toast.success("Notes saved.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the notes.");
    } finally {
      setSaving(null);
    }
  }

  const emailSubject = encodeURIComponent(`Your Geega Games sorting request ${detail.referenceNumber}`);
  const address = detail.returnAddress;
  const manualOptions: SortingStatus[] = SORTING_MANUAL_STATUSES.includes(detail.status)
    ? [...SORTING_MANUAL_STATUSES]
    : [detail.status, ...SORTING_MANUAL_STATUSES];

  return (
    <div className="gg-leaddetail gg-sortdetail">
      <section className="gg-leaddetail__section">
        <h3>Customer</h3>
        <p>
          <strong>
            {detail.firstName} {detail.lastName}
          </strong>{" "}
          <span className="gg-card-meta">{detail.userId ? "· has an account" : "· guest"}</span>
        </p>
        <div className="gg-leaddetail__contactlinks">
          <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`mailto:${detail.email}?subject=${emailSubject}`}>
            <Icon name="mail" size={14} /> {detail.email}
          </a>
          {detail.phone && (
            <>
              <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`tel:${detail.phone}`}>
                Call {detail.phone}
              </a>
              <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`sms:${detail.phone}`}>
                Text {detail.phone}
              </a>
            </>
          )}
        </div>
        <p className="gg-card-meta">
          Requested {formatDateTime(detail.createdAt)} · customer sees &ldquo;{sortingStatusLabel(detail.status, detail.deliveryMethod)}&rdquo;
        </p>
      </section>

      <section className="gg-leaddetail__section">
        <h3>Request</h3>
        <p>
          <strong>{detail.optionName}</strong> · {formatRatePerThousand(detail.ratePerThousandCents)}{" "}
          <span className="gg-card-meta">(the rate when they asked)</span>
        </p>
        <p>
          About {detail.estimatedCards.toLocaleString("en-US")} cards · estimate {formatCents(detail.estimatedSortingCents)}
          {shipped ? " before return shipping & packaging" : ""}
        </p>
        <p>{SORTING_DELIVERY_LABELS[detail.deliveryMethod]}</p>
        {detail.customerNotes && (
          <p>
            <strong>Customer notes:</strong> {detail.customerNotes}
          </p>
        )}
      </section>

      {shipped && address && (
        <section className="gg-leaddetail__section">
          <h3>Ship it back to</h3>
          <address className="gg-sortdetail__address">
            {address.recipient && <span>{address.recipient}</span>}
            <span>{address.line1}</span>
            {address.line2 && <span>{address.line2}</span>}
            <span>
              {address.city}, {address.state} {address.postalCode}
            </span>
          </address>
          {detail.shippingTermsAcceptedAt && (
            <p className="gg-card-meta">
              Agreed to the shipping terms {formatDateTime(detail.shippingTermsAcceptedAt)}: &ldquo;{detail.shippingTermsText}&rdquo;
            </p>
          )}
        </section>
      )}

      <section className="gg-leaddetail__section gg-leaddetail__internal">
        <h3>Status</h3>
        <div className="gg-form-grid">
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as SortingStatus)}>
            {manualOptions.map((s) => (
              <option key={s} value={s} disabled={!SORTING_MANUAL_STATUSES.includes(s)}>
                {SORTING_STATUS_ADMIN_LABELS[s]}
                {!SORTING_MANUAL_STATUSES.includes(s) ? " (set by the quote)" : ""}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Counted cards"
            inputMode="numeric"
            value={countedCards}
            onChange={(e) => setCountedCards(e.target.value)}
            hint="Your count, for the quote."
          />
        </div>
        {willEmail && (
          <TextArea
            label="Message to the customer (optional)"
            rows={2}
            maxLength={1000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            hint={
              status === "awaiting_cards"
                ? shipped
                  ? "The email includes our shipping address. Add anything else they need to know."
                  : "Suggest a drop-off time and place."
                : "Added to the status email."
            }
          />
        )}
        {shipped && (
          <div className="gg-form-grid">
            <TextField label="Return carrier" value={carrier} maxLength={40} onChange={(e) => setCarrier(e.target.value)} />
            <TextField
              label="Return tracking number"
              value={tracking}
              maxLength={80}
              onChange={(e) => setTracking(e.target.value)}
              hint="Included in the “on its way” email."
            />
          </div>
        )}
        <div className="gg-drawer-actions__buttons">
          <Button
            variant="primary"
            size="sm"
            loading={saving === "status"}
            disabled={saving !== null || (!statusChanged && !countChanged && !shipChanged)}
            onClick={saveStatus}
          >
            {willEmail ? "Save and email the customer" : "Save"}
          </Button>
        </div>
        <p className="gg-card-meta">
          Quote sent and Quote approved are set by the quote itself. Returned needs an approved quote that&rsquo;s paid in
          full.
        </p>
      </section>

      <SortingQuotePanel key={`quote-${detail.id}-${detail.quotes.map((q) => `${q.id}:${q.status}:${q.updatedAt}`).join(",")}`} detail={detail} onChanged={onChanged} />

      <SortingPaymentsPanel
        key={`pay-${detail.id}-${detail.amountPaidCents}-${detail.acceptedQuoteId ?? ""}`}
        detail={detail}
        onChanged={onChanged}
      />

      <section className="gg-leaddetail__section">
        <h3>Internal notes</h3>
        <TextArea label="Notes (staff only)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="gg-drawer-actions__buttons">
          <Button
            variant="secondary"
            size="sm"
            loading={saving === "notes"}
            disabled={saving !== null || notes === (detail.internalNotes ?? "")}
            onClick={saveNotes}
          >
            Save notes
          </Button>
        </div>
      </section>
    </div>
  );
}
