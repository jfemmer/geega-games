import { useRef, useState } from "react";
import type { SellPhoto } from "../../lib/sellTypes";

// "Selling a full collection? Upload photos instead." — drag/drop or the
// mobile camera/gallery picker. Each photo uploads directly to private
// Supabase Storage via a signed URL (see sellApi.uploadSellPhoto); this
// component only manages the client-side selection/preview/retry UI.

export const MAX_PHOTOS = 30;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function CollectionPhotoUpload({
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
  const [dragOver, setDragOver] = useState(false);
  const atLimit = photos.length >= MAX_PHOTOS;

  function pickFiles(files: File[]) {
    if (files.length === 0) return;
    onFilesSelected(files.slice(0, Math.max(0, MAX_PHOTOS - photos.length)));
  }

  return (
    <div className="gg-sellphotos">
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
      <div
        className={`gg-sellphotos__drop${dragOver ? " gg-sellphotos__drop--over" : ""}${
          atLimit ? " gg-sellphotos__drop--disabled" : ""
        }`}
        role="button"
        tabIndex={atLimit ? -1 : 0}
        aria-disabled={atLimit}
        onClick={() => !atLimit && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!atLimit && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!atLimit) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!atLimit) pickFiles(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <p>
          {atLimit
            ? `You've added the maximum of ${MAX_PHOTOS} photos.`
            : "Drag photos here, or tap to choose from your camera or gallery."}
        </p>
        {!atLimit && (
          <p className="gg-card-meta">
            JPEG, PNG, WEBP, or HEIC · up to 15 MB each · up to {MAX_PHOTOS} photos
          </p>
        )}
      </div>

      {photos.length > 0 && (
        <ul className="gg-sellphotos__grid">
          {photos.map((p) => (
            <li key={p.localId} className="gg-sellphotos__item">
              <img src={p.previewUrl} alt="" />
              {p.status === "uploading" && (
                <div className="gg-sellphotos__status" role="status">
                  Uploading…
                </div>
              )}
              {p.status === "error" && (
                <div className="gg-sellphotos__status gg-sellphotos__status--error" role="alert">
                  {p.errorMessage || "Upload failed"}
                  <button
                    type="button"
                    className="gg-btn gg-btn-ghost gg-btn-sm"
                    onClick={() => onRetry(p.localId)}
                  >
                    Retry
                  </button>
                </div>
              )}
              <button
                type="button"
                className="gg-sellphotos__remove"
                aria-label="Remove photo"
                onClick={() => onRemove(p.localId)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
