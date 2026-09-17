import { useRef } from "react";
import type { SellPhoto } from "../../lib/sellTypes";

// A compact, per-card photo spot inside SellCardList — shown when a card's
// claimed condition needs photo proof (see conditionNeedsPhotos). Two fixed
// slots rather than a free-for-all grid: proving a condition claim requires
// seeing BOTH sides of the card, so "one photo of whichever side" isn't
// enough — each slot holds exactly one photo and a new selection replaces
// whatever was there.

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function Slot({
  label,
  photo,
  onSelect,
  onRemove,
  onRetry,
}: {
  label: string;
  photo: SellPhoto | undefined;
  onSelect: (file: File) => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="gg-cardphoto__slot">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
          e.target.value = "";
        }}
      />
      {photo ? (
        <div className="gg-cardphoto__thumb">
          <img src={photo.previewUrl} alt={`${label} of card`} />
          {photo.status === "uploading" && (
            <div className="gg-cardphoto__status" role="status">
              Uploading…
            </div>
          )}
          {photo.status === "error" && (
            <div className="gg-cardphoto__status gg-cardphoto__status--error" role="alert">
              <button type="button" onClick={() => onRetry(photo.localId)}>
                Retry
              </button>
            </div>
          )}
          <button
            type="button"
            className="gg-cardphoto__remove"
            aria-label={`Remove ${label.toLowerCase()} photo`}
            onClick={() => onRemove(photo.localId)}
          >
            ×
          </button>
        </div>
      ) : (
        <button type="button" className="gg-cardphoto__add" onClick={() => inputRef.current?.click()}>
          + {label}
        </button>
      )}
      <span className="gg-cardphoto__label">{label}</span>
    </div>
  );
}

export function CardPhotoUpload({
  frontPhoto,
  backPhoto,
  onSelectFront,
  onSelectBack,
  onRemove,
  onRetry,
}: {
  frontPhoto: SellPhoto | undefined;
  backPhoto: SellPhoto | undefined;
  onSelectFront: (file: File) => void;
  onSelectBack: (file: File) => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}) {
  return (
    <div className="gg-cardphoto">
      <div className="gg-cardphoto__row">
        <Slot label="Front" photo={frontPhoto} onSelect={onSelectFront} onRemove={onRemove} onRetry={onRetry} />
        <Slot label="Back" photo={backPhoto} onSelect={onSelectBack} onRemove={onRemove} onRetry={onRetry} />
      </div>
    </div>
  );
}
