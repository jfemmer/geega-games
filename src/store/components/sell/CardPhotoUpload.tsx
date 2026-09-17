import { useRef } from "react";
import type { SellPhoto } from "../../lib/sellTypes";

// A compact, per-card photo spot inside SellCardList — smaller footprint
// than CollectionPhotoUpload (the general "whole collection" uploader in
// step 0), meant to sit directly under a single card row. Shares the same
// accepted types/upload plumbing (see SellPage.startUpload); this component
// only manages the small thumbnail strip + "+ Photo" affordance.

const MAX_PHOTOS_PER_CARD = 6;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function CardPhotoUpload({
  photos,
  onFilesSelected,
  onRemove,
  onRetry,
}: {
  photos: SellPhoto[];
  onFilesSelected: (files: File[]) => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = photos.length >= MAX_PHOTOS_PER_CARD;

  function pickFiles(files: File[]) {
    if (files.length === 0) return;
    onFilesSelected(files.slice(0, Math.max(0, MAX_PHOTOS_PER_CARD - photos.length)));
  }

  return (
    <div className="gg-cardphoto">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          pickFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div className="gg-cardphoto__row">
        {photos.map((p) => (
          <div className="gg-cardphoto__thumb" key={p.localId}>
            <img src={p.previewUrl} alt="" />
            {p.status === "uploading" && (
              <div className="gg-cardphoto__status" role="status">
                Uploading…
              </div>
            )}
            {p.status === "error" && (
              <div className="gg-cardphoto__status gg-cardphoto__status--error" role="alert">
                <button type="button" onClick={() => onRetry(p.localId)}>
                  Retry
                </button>
              </div>
            )}
            <button
              type="button"
              className="gg-cardphoto__remove"
              aria-label="Remove photo"
              onClick={() => onRemove(p.localId)}
            >
              ×
            </button>
          </div>
        ))}
        {!atLimit && (
          <button
            type="button"
            className="gg-cardphoto__add"
            onClick={() => inputRef.current?.click()}
          >
            + Photo
          </button>
        )}
      </div>
    </div>
  );
}
