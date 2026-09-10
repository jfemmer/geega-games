import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { CardFace, CardImageUris } from "../../types";

// Reusable card imagery + hover-to-enlarge preview.
//
// One component used EVERYWHERE card artwork appears (Scryfall search, inventory
// table, scan review, candidate lists, order references). It renders an
// appropriately small thumbnail and, on hover (desktop) or tap (touch), shows a
// substantially larger image in a viewport-clamped portal that:
//   - appears quickly, follows the pointer's side (flips left/right by space)
//   - stays fully within the viewport (never clipped)
//   - never shifts page layout, traps pointer events, or blocks scrolling
//   - supports front/back face switching for multi-faced cards
//   - falls back to a tap-to-open viewer on touch devices (no hover)
//
// It uses the "normal"/"large" Scryfall sizes for previews — never the full PNG
// — so scrolling through hundreds of results stays cheap.

/** Which image source a preview represents — styles the frame label. */
export type CardImageKind = "scryfall" | "scan";

interface FaceImages {
  label: string;
  images: CardImageUris;
}

export interface CardImageProps {
  /** Primary image set (front face / single-faced card). */
  images: CardImageUris | null;
  /** Optional additional faces for DFC/transform face-switching in the preview. */
  faces?: CardFace[] | null;
  alt: string;
  /** Thumbnail size preset. */
  size?: "xs" | "sm" | "md";
  /** Reference art (Scryfall) vs a physical scan. Affects the preview label. */
  kind?: CardImageKind;
  /** Overrides the small preview frame label. */
  previewLabel?: string;
  className?: string;
  /** Disable the enlarge behavior (plain thumbnail). */
  noPreview?: boolean;
}

const THUMB_DIMS: Record<NonNullable<CardImageProps["size"]>, { w: number; h: number }> = {
  xs: { w: 30, h: 42 },
  sm: { w: 44, h: 61 },
  md: { w: 64, h: 89 },
};

/** Best available image at a size, degrading gracefully. */
function pick(images: CardImageUris | null, prefer: "small" | "normal" | "large"): string | null {
  if (!images) return null;
  if (prefer === "small") return images.small ?? images.normal ?? images.large ?? images.png;
  if (prefer === "large") return images.large ?? images.normal ?? images.small ?? images.png;
  return images.normal ?? images.large ?? images.small ?? images.png;
}

function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(hover: none)").matches ?? "ontouchstart" in window;
}

const PREVIEW_W = 300; // px — matches .gg-cardpreview width in CSS
const PREVIEW_H = 418;
const GAP = 14;

export function CardImage({
  images,
  faces,
  alt,
  size = "sm",
  kind = "scryfall",
  previewLabel,
  className = "",
  noPreview = false,
}: CardImageProps) {
  const dims = THUMB_DIMS[size];
  const thumbSrc = pick(images, size === "md" ? "normal" : "small");

  const wrapRef = useRef<HTMLSpanElement>(null);
  const [preview, setPreview] = useState<CSSProperties | null>(null);
  const [faceIndex, setFaceIndex] = useState(0);
  // Detect touch (no-hover) once, after mount, so we never read a ref during
  // render to decide which handlers to attach.
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(isTouchDevice());
  }, []);

  // Build the list of faces available to preview. Prefer explicit faces (DFC),
  // else a single synthetic face from the primary images.
  const faceList: FaceImages[] =
    faces && faces.length > 0
      ? faces.map((f, i) => ({ label: f.name || `Face ${i + 1}`, images: f.images }))
      : images
        ? [{ label: previewLabel ?? alt, images }]
        : [];

  const multiFace = faceList.length > 1;

  const computePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Decide side: prefer right, flip to left when there's more room there.
    const spaceRight = vw - rect.right;
    const spaceLeft = rect.left;
    const onRight = spaceRight >= PREVIEW_W + GAP || spaceRight >= spaceLeft;

    let left = onRight ? rect.right + GAP : rect.left - PREVIEW_W - GAP;
    // Clamp horizontally within viewport.
    left = Math.max(GAP, Math.min(left, vw - PREVIEW_W - GAP));

    // Vertically center on the thumbnail, clamped to the viewport.
    let top = rect.top + rect.height / 2 - PREVIEW_H / 2;
    top = Math.max(GAP, Math.min(top, vh - PREVIEW_H - GAP));

    return { top, left } satisfies Pick<CSSProperties, "top" | "left">;
  }, []);

  const show = useCallback(() => {
    if (noPreview || faceList.length === 0) return;
    const pos = computePosition();
    if (pos) setPreview(pos);
  }, [computePosition, noPreview, faceList.length]);

  const hide = useCallback(() => {
    setPreview(null);
    setFaceIndex(0);
  }, []);

  // Hide preview on scroll/resize so it never floats out of place.
  useEffect(() => {
    if (!preview) return;
    const onScroll = () => hide();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [preview, hide]);

  function handleThumbClick() {
    if (!touch) return;
    // Touch: toggle the preview open/closed instead of hover.
    if (preview) hide();
    else show();
  }

  const activeFace = faceList[Math.min(faceIndex, faceList.length - 1)];
  const previewSrc = pick(activeFace?.images ?? null, "large");

  if (!thumbSrc) {
    return (
      <span
        className={`gg-cardimg gg-cardimg--${size} gg-cardimg--empty ${className}`}
        style={{ width: dims.w, height: dims.h }}
        aria-label={`${alt} (no image)`}
        role="img"
      />
    );
  }

  return (
    <span
      ref={wrapRef}
      className={`gg-cardimg gg-cardimg--${size} ${className}`}
      onMouseEnter={touch ? undefined : show}
      onMouseLeave={touch ? undefined : hide}
      onFocus={touch ? undefined : show}
      onBlur={touch ? undefined : hide}
    >
      <img
        src={thumbSrc}
        alt={alt}
        width={dims.w}
        height={dims.h}
        loading="lazy"
        decoding="async"
        className="gg-cardimg__thumb"
        onClick={touch ? handleThumbClick : undefined}
        tabIndex={noPreview ? undefined : 0}
      />

      {preview &&
        previewSrc &&
        createPortal(
          <div
            className={`gg-cardpreview gg-cardpreview--${kind}`}
            style={preview}
            // Pointer-events none so the preview never traps the cursor while
            // moving between thumbnails. Face buttons re-enable events locally.
            role="img"
            aria-label={`${activeFace?.label ?? alt}, enlarged`}
          >
            <img src={previewSrc} alt="" className="gg-cardpreview__img" />
            {multiFace && (
              <div className="gg-cardpreview__faces">
                {faceList.map((_f, i) => (
                  <button
                    key={i}
                    type="button"
                    className={
                      i === faceIndex
                        ? "gg-cardpreview__face gg-cardpreview__face--active"
                        : "gg-cardpreview__face"
                    }
                    // Re-enable pointer events only on the face toggles.
                    onMouseEnter={() => setFaceIndex(i)}
                    onClick={() => setFaceIndex(i)}
                  >
                    {i === 0 ? "Front" : i === 1 ? "Back" : `Face ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
