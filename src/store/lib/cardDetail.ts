import { storefrontImageUrl } from "./cardImages";
import type { CatalogCard } from "./useCatalog";

// What public.get_card_detail returns for one card: every in-stock copy of
// it, across printings and conditions, grouped by oracle id. Shared by the
// card page (/shop/card/<slug>) and the picks page (/shop/picks).

export type CardListing = {
  id: string;
  scryfallId: string | null;
  setCode: string | null;
  setName: string | null;
  collectorNumber: string | null;
  rarity: string | null;
  condition: string;
  finish: string;
  variantType: string | null;
  imageUrl: string | null;
  quantity: number;
  priceCents: number | null;
  isDeal: boolean;
  originalPriceCents: number | null;
  dealDiscountPercent: number | null;
  dealSource: "manual" | "aged_inventory" | "flawed" | null;
  dealNote: string | null;
};

export type CardDetail = {
  oracleId: string;
  cardName: string;
  listings: CardListing[];
  inStockCount: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  typeLine?: string | null;
  oracleText?: string | null;
  manaCost?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  flavorText?: string | null;
};

/** A card's in-stock copies as shop tiles (ProductCard), in the order listed. */
export function listingTiles(detail: Pick<CardDetail, "oracleId" | "cardName" | "typeLine" | "listings">): CatalogCard[] {
  return detail.listings
    .filter((l) => l.quantity > 0)
    .map((l) => ({
      id: l.id,
      oracleId: detail.oracleId,
      name: detail.cardName,
      set: l.setCode,
      setName: l.setName,
      collectorNumber: l.collectorNumber,
      type: detail.typeLine ?? null,
      rarity: l.rarity,
      quantity: l.quantity,
      imageUrl: storefrontImageUrl(l.imageUrl),
      priceCents: l.priceCents,
      condition: l.condition,
      finish: l.finish,
      foil: !!l.finish && l.finish !== "nonfoil",
      scryfallId: l.scryfallId,
      isDeal: l.isDeal,
      originalPriceCents: l.originalPriceCents,
      dealDiscountPercent: l.dealDiscountPercent,
      dealSource: l.dealSource,
      dealNote: l.dealNote,
      variantType: l.variantType || null,
    }));
}
