import { useState } from "react";
import { SellCardSearch } from "./SellCardSearch";
import { CardPhotoUpload } from "./CardPhotoUpload";
import { storefrontImageUrl } from "../../../cards";
import { formatCents } from "../../lib/money";
import {
  cardPhotoRequirementMet,
  conditionDefaultExplanation,
  conditionNeedsPhotos,
  defaultConditionForReleaseDate,
  SELL_CONDITION_OPTIONS,
  SELL_FINISH_OPTIONS,
  type SellCardLine,
  type SellPhoto,
  type SellPrinting,
} from "../../lib/sellTypes";

// The seller's running card list. Every line can be edited (quantity,
// condition, finish, notes), removed, or — for a line that isn't a confident
// exact-printing match yet — matched by searching for the right printing.
// Nothing pasted or typed is ever silently dropped: an unmatched line still
// shows its original text and stays fully editable/submittable.

function matchStatusLabel(status: SellCardLine["matchStatus"]): string | null {
  if (status === "ambiguous") return "Multiple printings match — please confirm";
  if (status === "unmatched") return "Couldn’t auto-match — pick the exact printing or leave as typed";
  return null;
}

export function SellCardList({
  cards,
  onUpdate,
  onRemove,
  onRematch,
  photos,
  onSelectCardPhoto,
  onRemoveCardPhoto,
  onRetryCardPhoto,
}: {
  cards: SellCardLine[];
  onUpdate: (localId: string, patch: Partial<SellCardLine>) => void;
  onRemove: (localId: string) => void;
  onRematch: (localId: string, printing: SellPrinting) => void;
  photos: SellPhoto[];
  onSelectCardPhoto: (cardLocalId: string, side: "front" | "back", file: File) => void;
  onRemoveCardPhoto: (localId: string) => void;
  onRetryCardPhoto: (localId: string) => void;
}) {
  const [matchingId, setMatchingId] = useState<string | null>(null);

  if (cards.length === 0) return null;

  return (
    <ul className="gg-sellcards">
      {cards.map((card) => {
        const needsReview = card.matchStatus !== "matched";
        const isMatching = matchingId === card.localId;
        // The auto-suggested-default EXPLANATION only applies to a card added
        // by searching for it directly — a pasted/CSV line's condition came
        // from the seller's own text/spreadsheet, not an auto-set default, so
        // there's nothing to "explain" there.
        const isManualEntry = card.rawInput == null;
        const ageBasedDefault = defaultConditionForReleaseDate(card.releasedAt);
        const conditionExplanation = isManualEntry ? conditionDefaultExplanation(ageBasedDefault) : null;
        // Whether a claimed condition needs photo proof applies to EVERY
        // card regardless of entry method — a condition typed into a pasted
        // list or CSV row is just as much a claim as one picked from the
        // dropdown, and must be held to the same standard.
        const needsPhotos = conditionNeedsPhotos(card.condition, ageBasedDefault);
        const frontPhoto = photos.find((p) => p.cardLocalId === card.localId && p.side === "front");
        const backPhoto = photos.find((p) => p.cardLocalId === card.localId && p.side === "back");
        const stillNeedsPhotos = needsPhotos && !cardPhotoRequirementMet(photos, card.localId);
        const showPhotoUpload = needsPhotos || frontPhoto != null || backPhoto != null;
        return (
          <li key={card.localId} className="gg-sellcard-row">
            <div className="gg-sellcard-row__main">
              <img
                className="gg-sellcard-row__thumb"
                src={card.imageUrl ? (storefrontImageUrl(card.imageUrl) ?? undefined) : undefined}
                alt=""
                loading="lazy"
                style={!card.imageUrl ? { background: "#ece6f7" } : undefined}
              />
              <div className="gg-sellcard-row__info">
                <div className="gg-sellcard-row__name">{card.cardName}</div>
                {(card.setName || card.collectorNumber) && (
                  <div className="gg-card-meta">
                    {card.setName}
                    {card.collectorNumber ? ` · #${card.collectorNumber}` : ""}
                  </div>
                )}
                {card.scryfallPriceCents != null && (
                  <div className="gg-card-meta">~{formatCents(card.scryfallPriceCents)} each (Scryfall reference)</div>
                )}
                {needsReview && (
                  <div className="gg-alert gg-alert-warn gg-sellcard-row__notice">
                    {matchStatusLabel(card.matchStatus)}
                    <button
                      type="button"
                      className="gg-btn gg-btn-ghost gg-btn-sm"
                      style={{ marginLeft: "0.6rem" }}
                      onClick={() => setMatchingId(isMatching ? null : card.localId)}
                    >
                      {isMatching ? "Cancel" : "Find exact printing"}
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="gg-sellcard-row__remove"
                aria-label={`Remove ${card.cardName}`}
                onClick={() => onRemove(card.localId)}
              >
                ×
              </button>
            </div>

            {isMatching && (
              <div className="gg-sellcard-row__matcher">
                <SellCardSearch
                  initialQuery={card.cardName}
                  onSelect={(printing) => {
                    onRematch(card.localId, printing);
                    setMatchingId(null);
                  }}
                />
              </div>
            )}

            <div className="gg-sellcard-row__fields">
              <label className="gg-sellcard-row__field">
                <span>Qty</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={card.quantity}
                  onChange={(e) =>
                    onUpdate(card.localId, {
                      quantity: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </label>
              <label className="gg-sellcard-row__field">
                <span>Condition</span>
                <select
                  value={card.condition ?? ""}
                  onChange={(e) =>
                    onUpdate(card.localId, {
                      condition: (e.target.value || null) as SellCardLine["condition"],
                    })
                  }
                >
                  {SELL_CONDITION_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value ?? ""}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gg-sellcard-row__field">
                <span>Finish</span>
                <select
                  value={card.finish}
                  onChange={(e) => onUpdate(card.localId, { finish: e.target.value })}
                >
                  {SELL_FINISH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {conditionExplanation && (
              <p className="gg-card-meta gg-sellcard-row__conditionnote">{conditionExplanation}</p>
            )}
            {stillNeedsPhotos && (
              <p className="gg-alert gg-alert-warn gg-sellcard-row__conditionnote" role="alert">
                Please add a photo of the <strong>front</strong> and a photo of the <strong>back</strong> of
                this card below so we can confirm the condition — both are required before you can submit.
              </p>
            )}
            {showPhotoUpload && (
              <CardPhotoUpload
                frontPhoto={frontPhoto}
                backPhoto={backPhoto}
                onSelectFront={(file) => onSelectCardPhoto(card.localId, "front", file)}
                onSelectBack={(file) => onSelectCardPhoto(card.localId, "back", file)}
                onRemove={onRemoveCardPhoto}
                onRetry={onRetryCardPhoto}
              />
            )}
            <label className="gg-field gg-sellcard-row__notes">
              <span>Notes (optional)</span>
              <input
                type="text"
                placeholder="e.g. signed, altered, specific printing details"
                value={card.sellerNotes}
                onChange={(e) => onUpdate(card.localId, { sellerNotes: e.target.value })}
              />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
