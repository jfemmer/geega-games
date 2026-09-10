import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { CardFace, CardImageUris } from "../../types";
import { imageCandidates } from "../../services/scryfall";
import { getAdminPortalContainer } from "../ui/portal";

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
//
// Robustness: the thumbnail and the preview each maintain an ORDERED list of
// candidate URLs (see imageCandidates). If the preferred size fails to load
// (CDN hiccup, missing size), onError advances to the next candidate rather than
// leaving a broken image. When every candidate is exhausted, a professional
// "No image available" placeholder is shown instead of an empty rectangle.
//
// Loading strategy: callers pass loadingPriority. Visible, above-the-fold
// thumbnails (current inventory/order/search rows) use "eager" so their art
// starts downloading WITH the page. Large/below-the-fold sets keep "lazy". The
// enlarged preview image is only requested on hover/tap, never at page load.

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
  /**
   * How the thumbnail should load. "eager" starts the request immediately with
   * the page render (use for visible rows); "lazy" defers until near-viewport
   * (use for long/below-the-fold sets). Defaults to "lazy" to preserve prior
   * behavior for callers that don't opt in.
   */
  loadingPriority?: "eager" | "lazy";
}

const THUMB_DIMS: Record<NonNullable<CardImageProps["size"]>, { w: number; h: number }> = {
  xs: { w: 30, h: 42 },
  sm: { w: 44, h: 61 },
  md: { w: 64, h: 89 },
};

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
  loadingPriority = "lazy",
}: CardImageProps) {
  const dims = THUMB_DIMS[size];

  // Ordered candidate URLs for the thumbnail, degrading through sizes. md uses a
  // "normal" source (sharper at 64px); xs/sm use "small" to save bandwidth.
  const thumbCandidates = useMemo(
    () => imageCandidates(images, size === "md" ? "normal" : "small"),
    [images, size],
  );
  // Which candidate index we're currently attempting for the thumbnail.
  const [thumbIdx, setThumbIdx] = useState(0);
  // Reset the attempt when the candidate list changes (new card/row) so a fresh
  // row always starts from its preferred size. Keyed by the joined URL list.
  const thumbKey = thumbCandidates.join("|");
  useEffect(() => {
    setThumbIdx(0);
  }, [thumbKey]);
  const thumbSrc = thumbCandidates[thumbIdx] ?? null;

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

  // Advance the thumbnail to its next candidate URL when the current one fails.
  // Incrementing past the end makes thumbSrc null, which renders the placeholder.
  const handleThumbError = useCallback(() => {
    setThumbIdx((i) => i + 1);
  }, []);

  const activeFace = faceList[Math.min(faceIndex, faceList.length - 1)];
  // Ordered candidates for the enlarged preview (large preferred).
  const previewCandidates = imageCandidates(activeFace?.images ?? null, "large");
  const [previewIdx, setPreviewIdx] = useState(0);
  // Reset the preview attempt when the active face changes or the preview
  // (re)opens, so each opening starts from the preferred (large) size.
  useEffect(() => {
    setPreviewIdx(0);
  }, [faceIndex, preview]);
  const previewSrc = previewCandidates[previewIdx] ?? null;
  const handlePreviewError = useCallback(() => {
    setPreviewIdx((i) => i + 1);
  }, []);

  // No usable thumbnail (either no images at all, or every candidate failed).
  if (!thumbSrc) {
    return (
      <span
        className={`gg-cardimg gg-cardimg--${size} gg-cardimg--empty ${className}`}
        style={{ width: dims.w, height: dims.h }}
        aria-label={`${alt} — no image available`}
        role="img"
        title="No image available"
      >
        <span className="gg-cardimg__emptylabel">No image</span>
      </span>
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
        loading={loadingPriority === "eager" ? "eager" : "lazy"}
        // fetchPriority nudges the browser: eager thumbnails matter for the
        // initial view; lazy ones stay low so we never flood the network. React
        // 19 supports the camelCase prop and lowercases it to the DOM attr.
        fetchPriority={loadingPriority === "eager" ? "high" : "low"}
        decoding="async"
        className="gg-cardimg__thumb"
        onClick={touch ? handleThumbClick : undefined}
        onError={handleThumbError}
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
            <img
              src={previewSrc}
              alt=""
              className="gg-cardpreview__img"
              onError={handlePreviewError}
            />
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
          getAdminPortalContainer(),
        )}
    </span>
  );
}