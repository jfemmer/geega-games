import { useState } from "react";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/ui/Icon";
import { TextField, SelectField, TextArea } from "../components/ui/Field";
import { useToast } from "../hooks/useToast";
import { buyingLeadsRepository } from "../repositories/buyingLeads.supabase";
import { formatCents, formatDateTime } from "../utils/format";
import {
  BUYING_LEAD_PRIORITY_LABELS,
  BUYING_LEAD_STATUS_LABELS,
  BUYING_LEAD_STATUS_TONE,
  COLLECTION_SIZE_LABELS,
  COLLECTION_TYPE_LABELS,
  CONDITION_LABELS,
  FINISH_LABELS,
  PREFERRED_CONTACT_LABELS,
  TIMELINE_LABELS,
  TRANSACTION_PREFERENCE_LABELS,
} from "../utils/labels";
import type { BuyingLeadDetail, BuyingLeadPriority, BuyingLeadStatus } from "../types";

const STATUS_OPTIONS: BuyingLeadStatus[] = [
  "new",
  "reviewing",
  "contacted",
  "offer_made",
  "accepted",
  "declined",
  "completed",
  "closed",
];

function dollarsFromCents(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}
function centsFromDollars(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function BuyingLeadDetailDrawer({
  lead,
  open,
  onClose,
  onChanged,
}: {
  lead: BuyingLeadDetail | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [savingField, setSavingField] = useState<string | null>(null);
  const [internalNotes, setInternalNotes] = useState(lead?.internalNotes ?? "");
  const [offerInput, setOfferInput] = useState(dollarsFromCents(lead?.offerValueCents ?? null));
  const [purchaseInput, setPurchaseInput] = useState(dollarsFromCents(lead?.purchaseAmountCents ?? null));

  if (!lead) return null;

  const location = [lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
  const emailSubject = encodeURIComponent(`Your Geega Games submission ${lead.referenceNumber}`);

  async function run(field: string, fn: () => Promise<void>, successMessage: string) {
    setSavingField(field);
    try {
      await fn();
      toast.success(successMessage);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingField(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Lead ${lead.referenceNumber}`}
      variant="drawer"
      size="lg"
      headerExtra={
        <Button
          variant="ghost"
          size="sm"
          icon="sparkle"
          aria-pressed={lead.favorited}
          onClick={() =>
            run(
              "favorited",
              () => buyingLeadsRepository.setFavorited(lead.id, !lead.favorited),
              lead.favorited ? "Removed star." : "Starred.",
            )
          }
        >
          {lead.favorited ? "Starred" : "Star"}
        </Button>
      }
    >
      <div className="gg-leaddetail">
        <section className="gg-leaddetail__section">
          <h3>Seller</h3>
          <p>
            <strong>
              {lead.firstName} {lead.lastName}
            </strong>{" "}
            <Badge tone={BUYING_LEAD_STATUS_TONE[lead.status]}>{BUYING_LEAD_STATUS_LABELS[lead.status]}</Badge>
          </p>
          <p className="gg-card-meta">Submitted {formatDateTime(lead.createdAt)}</p>
          <div className="gg-leaddetail__contactlinks">
            <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`mailto:${lead.email}?subject=${emailSubject}`}>
              <Icon name="mail" size={14} /> {lead.email}
            </a>
            {lead.phone && (
              <>
                <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`tel:${lead.phone}`}>
                  Call {lead.phone}
                </a>
                <a className="gg-btn gg-btn-ghost gg-btn-sm" href={`sms:${lead.phone}`}>
                  Text {lead.phone}
                </a>
              </>
            )}
          </div>
          <p className="gg-card-meta">
            Prefers {PREFERRED_CONTACT_LABELS[lead.preferredContactMethod] ?? lead.preferredContactMethod}
            {location ? ` · ${location}` : ""}
          </p>
          <p className="gg-card-meta">
            Wants to {TRANSACTION_PREFERENCE_LABELS[lead.transactionPreference] ?? lead.transactionPreference}
          </p>
        </section>

        <section className="gg-leaddetail__section">
          <h3>Collection</h3>
          <p>
            {lead.collectionSize ? (COLLECTION_SIZE_LABELS[lead.collectionSize] ?? lead.collectionSize) : "Size not specified"}
            {lead.timeline ? ` · ${TIMELINE_LABELS[lead.timeline] ?? lead.timeline}` : ""}
          </p>
          {lead.collectionTypes.length > 0 && (
            <p className="gg-card-meta">
              {lead.collectionTypes.map((t) => COLLECTION_TYPE_LABELS[t] ?? t).join(", ")}
            </p>
          )}
          {lead.collectionEras.length > 0 && (
            <p className="gg-card-meta">Eras: {lead.collectionEras.join(", ")}</p>
          )}
          {lead.valuableCardsNotes && (
            <p>
              <strong>Notable cards:</strong> {lead.valuableCardsNotes}
            </p>
          )}
          {lead.notes && (
            <p>
              <strong>Seller notes:</strong> {lead.notes}
            </p>
          )}
          {lead.referralSource && <p className="gg-card-meta">Heard about us via: {lead.referralSource}</p>}
          {lead.estimatedValueCents != null && (
            <div className="gg-inline-note gg-inline-note--info">
              <Icon name="dollar" size={16} />
              <div>
                Identified card market reference: <strong>{formatCents(lead.estimatedValueCents)}</strong>
                <br />
                <span className="gg-card-meta">
                  Internal Scryfall-based estimate only — not an offer. Condition, liquidity, and physical
                  inspection all matter.
                </span>
              </div>
            </div>
          )}
        </section>

        {lead.cards.length > 0 && (
          <section className="gg-leaddetail__section">
            <h3>Submitted cards ({lead.totalCards} total)</h3>
            <ul className="gg-leaddetail__cards">
              {lead.cards.map((c) => (
                <li key={c.id} className={c.matchStatus !== "matched" ? "gg-leaddetail__card--review" : undefined}>
                  {c.imageUrl ? (
                    <a href={c.imageUrl} target="_blank" rel="noopener noreferrer">
                      <img src={c.imageUrl} alt="" loading="lazy" />
                    </a>
                  ) : (
                    <div className="gg-leaddetail__cardimg--none" aria-hidden="true" />
                  )}
                  <div>
                    <div className="gg-card-name">{c.cardName}</div>
                    <div className="gg-card-meta">
                      {c.setName}
                      {c.collectorNumber ? ` · #${c.collectorNumber}` : ""}
                      {" · "}
                      {c.condition ? CONDITION_LABELS[c.condition] : "Unsure"} · {FINISH_LABELS[c.finish]} × {c.quantity}
                      {c.scryfallPriceCents != null ? ` · ~${formatCents(c.scryfallPriceCents)} each` : ""}
                    </div>
                    {c.matchStatus !== "matched" && (
                      <Badge tone="warning">
                        {c.matchStatus === "ambiguous" ? "Needs printing confirmation" : "Unmatched — as typed"}
                      </Badge>
                    )}
                    {c.sellerNotes && <div className="gg-card-meta">&ldquo;{c.sellerNotes}&rdquo;</div>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {lead.photos.length > 0 && (
          <section className="gg-leaddetail__section">
            <h3>Photos ({lead.photos.length})</h3>
            <ul className="gg-leaddetail__photos">
              {lead.photos.map((p) => (
                <li key={p.id}>
                  {p.signedUrl ? (
                    <a href={p.signedUrl} target="_blank" rel="noopener noreferrer">
                      <img src={p.signedUrl} alt={p.originalFilename} loading="lazy" />
                    </a>
                  ) : (
                    <div className="gg-leaddetail__cardimg--none" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="gg-leaddetail__section gg-leaddetail__internal">
          <h3>Internal tools</h3>
          <div className="gg-form-grid">
            <SelectField
              label="Status"
              value={lead.status}
              onChange={(e) =>
                run(
                  "status",
                  () => buyingLeadsRepository.setStatus(lead.id, e.target.value as BuyingLeadStatus),
                  "Status updated.",
                )
              }
              disabled={savingField === "status"}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {BUYING_LEAD_STATUS_LABELS[s]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Priority"
              value={lead.priority}
              onChange={(e) =>
                run(
                  "priority",
                  () => buyingLeadsRepository.setPriority(lead.id, e.target.value as BuyingLeadPriority),
                  "Priority updated.",
                )
              }
              disabled={savingField === "priority"}
            >
              <option value="normal">{BUYING_LEAD_PRIORITY_LABELS.normal}</option>
              <option value="high_interest">{BUYING_LEAD_PRIORITY_LABELS.high_interest}</option>
            </SelectField>
          </div>

          <div className="gg-form-grid">
            <TextField
              label="Offer amount (USD, internal)"
              type="number"
              min={0}
              step="0.01"
              value={offerInput}
              onChange={(e) => setOfferInput(e.target.value)}
            />
            <TextField
              label="Final purchase amount (USD, internal)"
              type="number"
              min={0}
              step="0.01"
              value={purchaseInput}
              onChange={(e) => setPurchaseInput(e.target.value)}
            />
          </div>
          <div className="gg-drawer-actions__buttons">
            <Button
              variant="secondary"
              size="sm"
              loading={savingField === "offer"}
              onClick={() =>
                run(
                  "offer",
                  () => buyingLeadsRepository.setOfferValueCents(lead.id, centsFromDollars(offerInput)),
                  "Offer amount saved.",
                )
              }
            >
              Save offer
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={savingField === "purchase"}
              onClick={() =>
                run(
                  "purchase",
                  () => buyingLeadsRepository.setPurchaseAmountCents(lead.id, centsFromDollars(purchaseInput)),
                  "Purchase amount saved.",
                )
              }
            >
              Save purchase amount
            </Button>
          </div>
          <p className="gg-card-meta">
            Offer and purchase amounts are internal only and are never shown to the seller.
          </p>

          <TextArea
            label="Internal notes (staff only)"
            rows={4}
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={savingField === "notes"}
            onClick={() =>
              run("notes", () => buyingLeadsRepository.setInternalNotes(lead.id, internalNotes), "Notes saved.")
            }
          >
            Save internal notes
          </Button>
        </section>
      </div>
    </Modal>
  );
}
