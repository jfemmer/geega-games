import { CardImage } from "./CardImage";
import { useCardImages } from "../../hooks/useCardImages";
import type { CardFinish, CardImageUris } from "../../types";

// CardImage for ORDER LINE ITEMS. Order items (like legacy inventory rows) carry
// only identity signals + a placeholder imageUrl, and NO scryfallId — so a raw
// <img src={imageUrl}> shows a blank/placeholder. This resolves the exact
// printing from Scryfall (id → set/cn → search, scored by set+collector+finish,
// name-gated) exactly like InventoryCardImage, so order thumbnails render real
// art. Resolution is cached app-wide, so a card shared across orders resolves
// once.

export function OrderCardImage({
  item,
  size = "xs",
  className,
  loadingPriority = "eager",
}: {
  item: {
    cardName: string;
    setCode: string | null;
    collectorNumber: string | null;
    imageUrl: string | null;
    finish?: CardFinish | null;
    scryfallId?: string | null;
    images?: CardImageUris | null;
  };
  size?: "xs" | "sm" | "md";
  className?: string;
  loadingPriority?: "eager" | "lazy";
}) {
  const images = useCardImages({
    scryfallId: item.scryfallId ?? null,
    setCode: item.setCode ?? "",
    collectorNumber: item.collectorNumber ?? "",
    imageUrl: item.imageUrl,
    cardName: item.cardName,
    finish: item.finish ?? null,
    images: item.images ?? null,
  });

  return (
    <CardImage
      images={images}
      alt={item.cardName}
      size={size}
      className={className}
      loadingPriority={loadingPriority}
    />
  );
}