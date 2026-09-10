import { CardImage } from "./CardImage";
import { useCardImages } from "../../hooks/useCardImages";
import type { CardFace, CardImageUris, InventoryItem } from "../../types";

// CardImage for inventory rows.
//
// PRIMARY path: if the row already carries a real image (structured `images`
// from a cached card_printings join, or a real http `imageUrl`), that art is
// used SYNCHRONOUSLY on first render — the <img> starts loading with the page,
// no post-mount Scryfall request.
//
// FALLBACK path: legacy rows that have only a placeholder/data-URI image and no
// scryfall_id are resolved on demand (preferring scryfall_id, else set +
// collector number), cached app-wide so a long table barely touches the network.
//
// `loadingPriority` defaults to "eager" because these rows are the visible,
// above-the-fold inventory table — their thumbnails should begin downloading
// immediately. Callers rendering long/below-the-fold lists can pass "lazy".

export function InventoryCardImage({
  item,
  size = "xs",
  faces,
  className,
  noPreview,
  loadingPriority = "eager",
}: {
  item: Pick<
    InventoryItem,
    "scryfallId" | "setCode" | "collectorNumber" | "imageUrl" | "cardName"
  > & {
    /** Optional pre-normalized images (e.g. from a cached card_printings row). */
    images?: CardImageUris | null;
  };
  size?: "xs" | "sm" | "md";
  faces?: CardFace[] | null;
  className?: string;
  noPreview?: boolean;
  loadingPriority?: "eager" | "lazy";
}) {
  const images = useCardImages({
    scryfallId: item.scryfallId ?? null,
    setCode: item.setCode,
    collectorNumber: item.collectorNumber,
    imageUrl: item.imageUrl,
    images: item.images ?? null,
  });

  return (
    <CardImage
      images={images}
      faces={faces}
      alt={item.cardName}
      size={size}
      className={className}
      noPreview={noPreview}
      loadingPriority={loadingPriority}
    />
  );
}