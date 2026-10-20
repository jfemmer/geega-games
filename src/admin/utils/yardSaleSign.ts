import type { CatalogCard } from "../../store/lib/useCatalog";
import { formatCents } from "../../store/lib/money";
import { YARD_SALE_PATH, yardSalePriceCents } from "../../store/lib/yardSale";
import { marketingLink, printedAddress, yardSaleFlyerCopy } from "./marketing";
import type { FlyerJob } from "../components/partners/FlyerPrintView";
import type { YardSaleShowcaseCard } from "../types";

// The printed yard sale sign (Yard Sale Mode → Print QR sign, and Marketing →
// the yard sale page → Print table sign): the QR code for /yard-sale with a
// few of the most valuable cards at the sale, at their yard sale prices, to
// show people browsing the tables what's online.

/** Cards featured on the sign. */
export const SIGN_SHOWCASE_SIZE = 4;

/**
 * The sign's featured cards from the yard sale page's own cards, most
 * valuable first (as search_inventory returns them with "price_desc"): one
 * per card name, only cards with a picture and a price.
 */
export function pickYardSaleShowcase(
  cards: CatalogCard[],
  discountPercent: number,
  limit = SIGN_SHOWCASE_SIZE,
): YardSaleShowcaseCard[] {
  const seen = new Set<string>();
  const picked: YardSaleShowcaseCard[] = [];
  for (const card of cards) {
    if (picked.length >= limit) break;
    const price = card.priceCents ?? 0;
    const key = card.name.toLowerCase();
    if (!card.imageUrl || price <= 0 || card.quantity <= 0 || seen.has(key)) continue;
    seen.add(key);
    picked.push({
      id: card.id,
      // The front of a double-faced card is the name people know it by.
      name: card.name.split(" // ")[0],
      imageUrl: card.imageUrl,
      foil: card.finish !== "nonfoil",
      priceCents: price,
      salePriceCents: yardSalePriceCents(price, discountPercent),
    });
  }
  return picked;
}

/** "$58" for whole dollars (yard sale prices always are), else "$64.99". */
export function formatSignPrice(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : formatCents(cents);
}

/** The print job for the yard sale sign. */
export function yardSaleSignJob({
  minPriceCents,
  discountPercent,
  showcase,
  extraLine = null,
  printedAt = new Date(),
}: {
  minPriceCents: number;
  discountPercent: number;
  showcase: YardSaleShowcaseCard[];
  extraLine?: string | null;
  printedAt?: Date;
}): FlyerJob {
  return {
    layout: "yard-sale",
    copy: yardSaleFlyerCopy(minPriceCents),
    url: marketingLink(YARD_SALE_PATH, {}),
    address: printedAddress(YARD_SALE_PATH),
    extraLine,
    yardSale: { showcase, discountPercent, printedAt: printedAt.toISOString() },
  };
}
