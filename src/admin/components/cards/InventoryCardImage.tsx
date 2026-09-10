import { CardImage } from "./CardImage";
import { useCardImages } from "../../hooks/useCardImages";
import type { CardFace, InventoryItem } from "../../types";

// CardImage for inventory rows. Resolves REAL Scryfall art on demand for rows
// that lack it (legacy rows / placeholder images), preferring scryfall_id and
// falling back to set code + collector number. Results are cached app-wide so a
// long table barely touches the network. Once a row has a real stored image (or
// a scryfall-linked item), no lookup happens.

export function InventoryCardImage({
  item,
  size = "xs",
  faces,
  className,
  noPreview,
}: {
  item: Pick<
    InventoryItem,
    "scryfallId" | "setCode" | "collectorNumber" | "imageUrl" | "cardName"
  >;
  size?: "xs" | "sm" | "md";
  faces?: CardFace[] | null;
  className?: string;
  noPreview?: boolean;
}) {
  const images = useCardImages({
    scryfallId: item.scryfallId ?? null,
    setCode: item.setCode,
    collectorNumber: item.collectorNumber,
    imageUrl: item.imageUrl,
  });

  return (
    <CardImage
      images={images}
      faces={faces}
      alt={item.cardName}
      size={size}
      className={className}
      noPreview={noPreview}
    />
  );
}