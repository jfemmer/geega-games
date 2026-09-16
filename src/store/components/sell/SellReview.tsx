import { storefrontImageUrl } from "../../../cards";
import {
  SELL_COLLECTION_SIZE_OPTIONS,
  SELL_COLLECTION_TYPE_OPTIONS,
  SELL_TIMELINE_OPTIONS,
  type SellCardLine,
  type SellCollectionInfo,
  type SellContactInfo,
  type SellPhoto,
} from "../../lib/sellTypes";

function labelFor(options: { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

const CONTACT_METHOD_LABELS: Record<SellContactInfo["preferredContactMethod"], string> = {
  email: "email",
  phone: "a phone call",
  text: "a text message",
};

export function SellReview({
  contact,
  collection,
  cards,
  photos,
  onEditStep,
}: {
  contact: SellContactInfo;
  collection: SellCollectionInfo;
  cards: SellCardLine[];
  photos: SellPhoto[];
  onEditStep: (step: number) => void;
}) {
  const totalQty = cards.reduce((sum, c) => sum + c.quantity, 0);
  const uploadedPhotos = photos.filter((p) => p.status === "uploaded" || p.status === "uploading");
  const location = [contact.city, contact.state].filter(Boolean).join(", ");

  return (
    <div className="gg-sellreview">
      <section className="gg-sellreview__section">
        <div className="gg-sellreview__head">
          <h3>Contact information</h3>
          <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => onEditStep(2)}>
            Edit
          </button>
        </div>
        <p>
          {contact.firstName} {contact.lastName} · {contact.email}
          {contact.phone ? ` · ${contact.phone}` : ""}
        </p>
        <p className="gg-card-meta">
          Prefers {CONTACT_METHOD_LABELS[contact.preferredContactMethod]}
          {location ? ` · ${location}` : ""}
        </p>
      </section>

      <section className="gg-sellreview__section">
        <div className="gg-sellreview__head">
          <h3>What you&rsquo;re selling</h3>
          <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => onEditStep(0)}>
            Edit
          </button>
        </div>
        {cards.length > 0 && (
          <p>
            {cards.length} identified card line{cards.length === 1 ? "" : "s"} ({totalQty} card
            {totalQty === 1 ? "" : "s"} total)
          </p>
        )}
        {uploadedPhotos.length > 0 && (
          <p>
            {uploadedPhotos.length} photo{uploadedPhotos.length === 1 ? "" : "s"} attached
          </p>
        )}
        {cards.length === 0 && uploadedPhotos.length === 0 && (
          <p className="gg-card-meta">No cards or photos added yet.</p>
        )}
        {cards.length > 0 && (
          <ul className="gg-sellreview__cardpreview">
            {cards.slice(0, 6).map((c) => (
              <li key={c.localId}>
                {c.imageUrl && <img src={storefrontImageUrl(c.imageUrl) ?? undefined} alt="" loading="lazy" />}
                <span>
                  {c.quantity}× {c.cardName}
                </span>
              </li>
            ))}
            {cards.length > 6 && <li className="gg-card-meta">+ {cards.length - 6} more</li>}
          </ul>
        )}
        {uploadedPhotos.length > 0 && (
          <ul className="gg-sellreview__photopreview">
            {uploadedPhotos.slice(0, 6).map((p) => (
              <li key={p.localId}>
                <img src={p.previewUrl} alt="" />
              </li>
            ))}
            {uploadedPhotos.length > 6 && <li className="gg-card-meta">+ {uploadedPhotos.length - 6} more</li>}
          </ul>
        )}
      </section>

      <section className="gg-sellreview__section">
        <div className="gg-sellreview__head">
          <h3>Collection details</h3>
          <button type="button" className="gg-btn gg-btn-ghost gg-btn-sm" onClick={() => onEditStep(1)}>
            Edit
          </button>
        </div>
        <p>
          {collection.collectionSize
            ? labelFor(SELL_COLLECTION_SIZE_OPTIONS, collection.collectionSize)
            : "Size not specified"}
          {collection.timeline ? ` · ${labelFor(SELL_TIMELINE_OPTIONS, collection.timeline)}` : ""}
        </p>
        {collection.collectionTypes.length > 0 && (
          <p className="gg-card-meta">
            {collection.collectionTypes.map((t) => labelFor(SELL_COLLECTION_TYPE_OPTIONS, t)).join(", ")}
          </p>
        )}
        {collection.valuableCardsNotes && (
          <p className="gg-card-meta">Valuable cards noted: {collection.valuableCardsNotes}</p>
        )}
        {collection.notes && <p className="gg-card-meta">&ldquo;{collection.notes}&rdquo;</p>}
      </section>
    </div>
  );
}
